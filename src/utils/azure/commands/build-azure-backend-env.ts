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
  /** Managed identity client ID (from Terraform). When set, container uses MI for Key Vault. */
  managedIdentityClientId?: string;
}

interface AzureBackendEnv {
  envVars: Array<{ name: string; value: string }>;
  secrets: Array<{ name: string; value: string }>;
  secretEnvVars: Array<{ name: string; secretRef: string }>;
}

export function buildAzureBackendEnv(
  config: BuildAzureBackendEnvConfig,
): AzureBackendEnv {
  const { logger } = getContext();
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

  // Inject Azure credentials for SecretsProvider
  const keyVaultName = `${projectName}-${targetEnv}-kv`;

  if (config.managedIdentityClientId) {
    // Managed identity: AZURE_CLIENT_ID = MI's client ID (selects user-assigned identity)
    // DefaultAzureCredential in the NestJS app picks up the MI automatically.
    // No AZURE_CLIENT_SECRET or AZURE_TENANT_ID needed.
    envVars.push(
      { name: 'AZURE_CLIENT_ID', value: config.managedIdentityClientId },
      { name: 'AZURE_KEYVAULT_NAME', value: keyVaultName },
    );
    logger.info('  Injecting managed identity credentials for SecretsProvider');
  } else {
    // Fallback: SP credentials (old Terraform without MI)
    envVars.push(
      { name: 'AZURE_CLIENT_ID', value: credentials.clientId },
      { name: 'AZURE_TENANT_ID', value: credentials.tenantId },
      { name: 'AZURE_KEYVAULT_NAME', value: keyVaultName },
    );
    if (credentials.clientSecret) {
      secrets.push({
        name: 'azure-client-secret',
        value: credentials.clientSecret,
      });
      secretEnvVars.push({
        name: 'AZURE_CLIENT_SECRET',
        secretRef: 'azure-client-secret',
      });
    }
    logger.info('  Injecting SP credentials for SecretsProvider');
  }

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
