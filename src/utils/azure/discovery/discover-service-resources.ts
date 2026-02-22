/**
 * Discover Service Resources (Azure)
 *
 * Orchestrates all discovery calls to determine what cloud resources
 * exist for a specific service. Infers service type from discovered resources.
 *
 * Cloud is the source of truth - this allows status checks even if service
 * has already been removed from config.json.
 */

import type { AzureCredentials } from 'tsdevstack/plugin';
import { getContainerApp } from './get-container-app';
import { storageAccountExists } from './storage-account-exists';
import { listKeyVaultSecretsByPrefix } from './list-keyvault-secrets-by-prefix';
import { databaseExists } from './database-exists';

export interface DiscoverServiceResourcesOptions {
  serviceName: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

export interface DiscoveredResources {
  // Container App (backends, workers, kong, nextjs)
  containerApp: boolean;
  containerAppStatus?: string;
  containerAppUrl?: string;
  containerAppReplicas?: number;
  containerAppImage?: string;

  // SPA Storage Account
  spaBucket: boolean;
  spaBucketName: string;

  // Key Vault Secrets
  secrets: string[];

  /**
   * Inferred type based on discovered resources:
   * - 'backend': Container App with standard name
   * - 'worker': Container App with "-worker" suffix
   * - 'kong': Container App named "kong"
   * - 'nextjs': Container App named "frontend"
   * - 'spa': Only SPA storage exists
   * - 'unknown': No resources found
   */
  inferredType: 'backend' | 'worker' | 'kong' | 'nextjs' | 'spa' | 'unknown';

  /** True if service has a database (checked directly on PostgreSQL server) */
  hasDatabase: boolean;
}

/**
 * Discover all cloud resources for a service on Azure
 */
export async function discoverServiceResources(
  options: DiscoverServiceResourcesOptions,
): Promise<DiscoveredResources> {
  const { serviceName, projectName, targetEnv, credentials } = options;

  const resourceGroupName = `${projectName}-${targetEnv}-rg`;
  const containerAppName = `${projectName}-${serviceName}`;
  const vaultName = `${projectName}-${targetEnv}-kv`;
  const serverName = `${projectName}-${targetEnv}-postgres`;
  // SPA storage: {project}{env}{name}spa (alphanumeric only)
  const sanitizedProject = projectName.replace(/[^a-z0-9]/g, '');
  const spaBucketName = `${sanitizedProject}${targetEnv}${serviceName.replace(/[^a-z0-9]/g, '')}spa`;
  const secretPrefix = `${projectName}-${serviceName}-`;

  // Run all discovery calls in parallel for performance
  const [containerAppResult, bucketResult, secretsResult, databaseResult] =
    await Promise.all([
      getContainerApp({
        credentials,
        resourceGroupName,
        containerAppName,
      }),
      storageAccountExists({
        credentials,
        resourceGroupName,
        storageAccountName: spaBucketName,
      }),
      listKeyVaultSecretsByPrefix({
        credentials,
        vaultName,
        prefix: secretPrefix,
      }),
      databaseExists({
        databaseName: serviceName,
        serverName,
        resourceGroupName,
        credentials,
      }),
    ]);

  const hasApp = containerAppResult.success && containerAppResult.app.exists;
  const hasBucket = bucketResult.exists;
  const hasDatabase = databaseResult.exists;

  // Infer type from discovered resources and service name
  let inferredType: DiscoveredResources['inferredType'] = 'unknown';
  if (hasApp) {
    if (serviceName === 'kong') {
      inferredType = 'kong';
    } else if (serviceName === 'frontend') {
      inferredType = 'nextjs';
    } else if (serviceName.endsWith('-worker')) {
      inferredType = 'worker';
    } else {
      inferredType = 'backend';
    }
  } else if (hasBucket) {
    inferredType = 'spa';
  }

  const secrets = secretsResult.success ? secretsResult.secrets : [];

  return {
    containerApp: hasApp,
    containerAppStatus: hasApp ? containerAppResult.app.status : undefined,
    containerAppUrl: hasApp ? containerAppResult.app.fqdn : undefined,
    containerAppReplicas: hasApp ? containerAppResult.app.replicas : undefined,
    containerAppImage: hasApp ? containerAppResult.app.image : undefined,

    spaBucket: hasBucket,
    spaBucketName,

    secrets,

    inferredType,
    hasDatabase,
  };
}
