/**
 * Pick the secret and service account a GCP migration job runs with
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { getTerraformOutputJson } from './terraform';

export interface ResolveGcpMigrationJobAccessOptions {
  projectName: string;
  serviceName: string;
  credentials: GCPCredentials;
  terraformDir: string;
  tfEnv: Record<string, string>;
  /** The service's runtime account (environments not converted yet) */
  runtimeServiceAccount: string;
}

export interface GcpMigrationJobAccess {
  /** Secret the job gets as DATABASE_URL */
  secretName: string;
  serviceAccount: string;
}

/**
 * Migrations change the schema, so they connect as the owner role: the job
 * gets {project}-{service}-MIGRATION_DATABASE_URL as DATABASE_URL and runs
 * as the service's migration account, which can read only that secret (the
 * service's own account can't read it, and the code in the job can use the
 * job's account, so not the database jobs' one). In an environment
 * infra:deploy has not converted yet that secret doesn't exist;
 * DATABASE_URL still holds the owner there and the service's account
 * reads it.
 *
 * @throws CliError when Secret Manager can't be asked, or the service has
 * no migration account in the Terraform outputs
 */
export async function resolveGcpMigrationJobAccess(
  options: ResolveGcpMigrationJobAccessOptions,
): Promise<GcpMigrationJobAccess> {
  const {
    buildGCPClientOptions,
    buildSecretName,
    CliError,
    MIGRATION_DATABASE_URL_KEY,
  } = getContext();
  const migrationSecret = buildSecretName(
    options.projectName,
    options.serviceName,
    MIGRATION_DATABASE_URL_KEY,
  );

  const client = new SecretManagerServiceClient(
    buildGCPClientOptions(options.credentials),
  );
  try {
    await client.getSecret({
      name: `projects/${options.credentials.project_id}/secrets/${migrationSecret}`,
    });
  } catch (error) {
    // gRPC NOT_FOUND: not converted yet
    if ((error as { code?: number }).code === 5) {
      return {
        secretName: buildSecretName(
          options.projectName,
          options.serviceName,
          'DATABASE_URL',
        ),
        serviceAccount: options.runtimeServiceAccount,
      };
    }
    throw new CliError(
      `Could not check the secret ${migrationSecret}`,
      'Database migration',
      error instanceof Error ? error.message : String(error),
    );
  }

  const migrationAccounts = getTerraformOutputJson<Record<string, string>>(
    options.terraformDir,
    'migration_service_account_emails',
    options.tfEnv,
  );
  const serviceAccount = migrationAccounts[options.serviceName];
  if (!serviceAccount) {
    throw new CliError(
      `No migration service account for ${options.serviceName} in the Terraform outputs`,
      'Database migration',
      'Run npx tsdevstack infra:deploy for this environment to create it',
    );
  }
  return { secretName: migrationSecret, serviceAccount };
}
