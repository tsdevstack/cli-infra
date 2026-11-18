/**
 * Pick the secret an AWS migration task connects with
 */

import {
  DescribeSecretCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { buildAWSClientConfig } from './build-aws-client-config';

export interface ResolveAwsMigrationSecretNameOptions {
  projectName: string;
  serviceName: string;
  credentials: AWSCredentials;
}

/**
 * Migrations change the schema, so they connect as the owner role: the
 * task gets {project}-{service}-MIGRATION_DATABASE_URL as DATABASE_URL. In
 * an environment db-init has not converted yet that secret doesn't exist,
 * and DATABASE_URL still holds the owner.
 *
 * @returns The secret's name
 * @throws CliError when Secrets Manager can't be asked
 */
export async function resolveAwsMigrationSecretName(
  options: ResolveAwsMigrationSecretNameOptions,
): Promise<string> {
  const { buildSecretName, CliError, MIGRATION_DATABASE_URL_KEY } =
    getContext();
  const migrationSecret = buildSecretName(
    options.projectName,
    options.serviceName,
    MIGRATION_DATABASE_URL_KEY,
  );

  const client = new SecretsManagerClient(
    buildAWSClientConfig(options.credentials),
  );
  try {
    await client.send(new DescribeSecretCommand({ SecretId: migrationSecret }));
    return migrationSecret;
  } catch (error) {
    if (error instanceof Error && error.name === 'ResourceNotFoundException') {
      return buildSecretName(
        options.projectName,
        options.serviceName,
        'DATABASE_URL',
      );
    }
    throw new CliError(
      `Could not check the secret ${migrationSecret}`,
      'Database migration',
      error instanceof Error ? error.message : String(error),
    );
  }
}
