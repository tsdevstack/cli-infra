/**
 * Pick the Key Vault secret and identity an Azure migration job runs with
 */

import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { buildKeyVaultSecretUrl } from './key-vault/build-key-vault-secret-url';
import { readKeyVaultSecret } from './key-vault/read-key-vault-secret';
import { getServiceSecretsIdentities, getTerraformOutput } from './terraform';

export interface ResolveAzureMigrationJobAccessOptions {
  projectName: string;
  targetEnv: string;
  serviceName: string;
  credentials: AzureCredentials;
  /** The environment's Terraform folder (for its outputs) */
  terraformDir: string;
  tfEnv: Record<string, string>;
}

export interface AzureMigrationJobAccess {
  /** Key Vault secret the job gets as DATABASE_URL */
  keyVaultSecretUrl: string;
  /** Identity (resource ID) Container Apps reads the secret with */
  identityId: string;
}

/**
 * Migrations change the schema, so they connect as the owner role: the job
 * gets MIGRATION_DATABASE_URL from the database jobs' vault, read with the
 * database jobs' identity (no service can read that vault). In an
 * environment infra:deploy has not converted yet that vault or secret
 * doesn't exist; DATABASE_URL in the service's own vault still holds the
 * server admin there, and the service's identity reads it.
 *
 * Container Apps fetches the secret itself, so no password is in the job's
 * settings. The CLI only checks the secret exists.
 *
 * @returns The secret and identity, or null when neither secret exists
 * @throws CliError when the service has no Key Vault identity
 */
export async function resolveAzureMigrationJobAccess(
  options: ResolveAzureMigrationJobAccessOptions,
): Promise<AzureMigrationJobAccess | null> {
  const {
    keyVaultExists,
    resolveKeyVaultName,
    buildSecretName,
    CliError,
    MIGRATION_DATABASE_URL_KEY,
    AZURE_DB_JOBS_KEY_VAULT_SCOPE,
  } = getContext();
  const { credentials, projectName, targetEnv, serviceName } = options;
  // Key Vault names use hyphens
  const vaultSecretName = (key: string): string =>
    buildSecretName(projectName, serviceName, key).replace(/_/g, '-');
  const secretExists = async (
    vaultName: string,
    secretName: string,
  ): Promise<boolean> =>
    (await readKeyVaultSecret({ credentials, vaultName, secretName })) !== null;

  if (
    await keyVaultExists(
      credentials,
      projectName,
      targetEnv,
      AZURE_DB_JOBS_KEY_VAULT_SCOPE,
    )
  ) {
    const vaultName = await resolveKeyVaultName(
      credentials,
      projectName,
      targetEnv,
      AZURE_DB_JOBS_KEY_VAULT_SCOPE,
    );
    const secretName = vaultSecretName(MIGRATION_DATABASE_URL_KEY);
    if (await secretExists(vaultName, secretName)) {
      return {
        keyVaultSecretUrl: buildKeyVaultSecretUrl(vaultName, secretName),
        identityId: getTerraformOutput(
          options.terraformDir,
          'db_jobs_identity_id',
          options.tfEnv,
        ),
      };
    }
  }

  // Not converted yet
  const vaultName = await resolveKeyVaultName(
    credentials,
    projectName,
    targetEnv,
    serviceName,
  );
  const secretName = vaultSecretName('DATABASE_URL');
  if (!(await secretExists(vaultName, secretName))) {
    return null;
  }
  const identity = getServiceSecretsIdentities(
    options.terraformDir,
    options.tfEnv,
  )[serviceName];
  if (!identity) {
    throw new CliError(
      `No Key Vault identity for ${serviceName} in the Terraform outputs`,
      'Database migration',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to create it`,
    );
  }
  return {
    keyVaultSecretUrl: buildKeyVaultSecretUrl(vaultName, secretName),
    identityId: identity.id,
  };
}
