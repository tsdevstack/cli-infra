/**
 * Build Azure Backend Environment
 *
 * Builds env vars, secrets, and secret refs for NestJS backend services
 * on Azure Container Apps. Used by both the service orchestrator and
 * standalone worker deploy command.
 */

import { getContext } from '../../../context';
import { buildBackendEnvVars } from '@tsdevstack/infra-core';
import { fetchSecret } from '../../credentials/fetch-secret';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

interface BuildAzureBackendEnvConfig {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  serviceName: string;
  hasDatabase: boolean;
  hasStorage: boolean;
  poolMax: number;
  /** Shared Container Apps identity's client ID (AZURE_CLIENT_ID: registry, storage) */
  managedIdentityClientId?: string;
  /** The service's own Key Vault identity's client ID (AZURE_SECRETS_CLIENT_ID) */
  secretsIdentityClientId: string;
}

interface AzureBackendEnv {
  envVars: Array<{ name: string; value: string }>;
  secrets: Array<{ name: string; value: string }>;
  secretEnvVars: Array<{ name: string; secretRef: string }>;
}

export function buildAzureBackendEnv(
  config: BuildAzureBackendEnvConfig,
): AzureBackendEnv {
  const {
    logger,
    CliError,
    buildKeyVaultName,
    AZURE_KEYVAULT_NAME_ENV,
    AZURE_SERVICE_KEYVAULT_NAME_ENV,
  } = getContext();
  const {
    projectName,
    targetEnv,
    credentials,
    serviceName,
    hasDatabase,
    poolMax,
  } = config;

  // Build standard backend env vars (NODE_ENV, CLOUD_PROVIDER, etc.)
  const standardEnvVars = buildBackendEnvVars({
    provider: 'azure',
    projectName,
    projectId: credentials.subscriptionId,
    poolMax,
  });

  const envVars = Object.entries(standardEnvVars).map(([name, value]) => ({
    name,
    value,
  }));

  const secrets: Array<{ name: string; value: string }> = [];
  const secretEnvVars: Array<{ name: string; secretRef: string }> = [];

  // Key Vault access, with managed identities only. The service reads its
  // secrets with its own identity (the shared vault and its own vault); the
  // shared identity stays AZURE_CLIENT_ID for everything else. The deploy
  // credentials are never injected: they could read every secret.
  if (!config.managedIdentityClientId) {
    throw new CliError(
      'The Container Apps managed identity is missing from the Terraform outputs',
      'infra:deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to create it`,
    );
  }
  envVars.push(
    { name: 'AZURE_CLIENT_ID', value: config.managedIdentityClientId },
    { name: 'AZURE_SECRETS_CLIENT_ID', value: config.secretsIdentityClientId },
    {
      name: AZURE_KEYVAULT_NAME_ENV,
      value: buildKeyVaultName(projectName, targetEnv),
    },
    {
      name: AZURE_SERVICE_KEYVAULT_NAME_ENV,
      value: buildKeyVaultName(projectName, targetEnv, serviceName),
    },
  );
  logger.info('  Injecting managed identities and Key Vault names');

  // Azure Storage Account name for StorageModule
  if (config.hasStorage) {
    const storageAccountName = `${projectName.replace(/[^a-z0-9]/g, '')}${targetEnv}storage`;
    envVars.push({
      name: 'AZURE_STORAGE_ACCOUNT_NAME',
      value: storageAccountName,
    });
    logger.info('  Injecting storage account name for StorageModule');
  }

  // DATABASE_URL for services with databases
  if (hasDatabase) {
    const databaseUrl = fetchSecret('DATABASE_URL', targetEnv, serviceName);
    if (databaseUrl) {
      secrets.push({ name: 'database-url', value: databaseUrl });
      secretEnvVars.push({
        name: 'DATABASE_URL',
        secretRef: 'database-url',
      });
      logger.info('  Injecting DATABASE_URL secret');
    }
  }

  return { envVars, secrets, secretEnvVars };
}
