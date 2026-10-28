/**
 * Build Deletion Steps (Azure)
 *
 * Build deletion steps based on discovered resources.
 *
 * Order is critical:
 * 1. Coupled workers (Container Apps)
 * 2. Container App (stop traffic)
 * 3. SPA Storage Account
 * 4. PostgreSQL database
 * 5. Terraform state sync (uses pre-fetched DB passwords)
 * 6. Service-scoped Key Vault secrets
 * 7. Shared secrets cleanup
 */

import { getContext } from '../../../context';
import type { DeletionStep } from './types';
import type { AzureCommandContext } from '../commands/types';
import type { DiscoveredResources, CoupledWorkerInfo } from '../discovery';
import {
  deleteContainerApp,
  deleteStorageAccount,
  deleteDatabase,
  deleteKeyVaultSecretsByPrefix,
  deleteSharedSecretsForService,
} from '../delete';
import { syncTerraformState } from './sync-terraform-state';

export interface BuildDeletionStepsOptions {
  ctx: AzureCommandContext;
  serviceName: string;
  discovered: DiscoveredResources;
  projectName: string;
  targetEnv: string;
  dbPasswords: Record<string, string>;
  coupledWorkers: CoupledWorkerInfo[];
}

/**
 * Build deletion steps based on discovered resources
 */
export function buildDeletionSteps(
  options: BuildDeletionStepsOptions,
): DeletionStep[] {
  const {
    ctx,
    serviceName,
    discovered,
    projectName,
    targetEnv,
    dbPasswords,
    coupledWorkers,
  } = options;
  const { credentials } = ctx;
  const resourceGroupName = `${projectName}-${targetEnv}-rg`;
  const { buildKeyVaultName } = getContext();
  const vaultName = buildKeyVaultName(projectName, targetEnv);
  const steps: DeletionStep[] = [];

  // 0. Delete coupled workers first
  for (const worker of coupledWorkers) {
    steps.push({
      name: 'Coupled worker',
      resource: worker.name,
      execute: () =>
        deleteContainerApp({
          credentials,
          resourceGroupName,
          containerAppName: worker.containerAppName,
        }),
    });
  }

  // 1. Delete Container App (stops traffic)
  if (discovered.containerApp) {
    steps.push({
      name: 'Container App',
      resource: serviceName,
      execute: () =>
        deleteContainerApp({
          credentials,
          resourceGroupName,
          containerAppName: `${projectName}-${serviceName}`,
        }),
    });
  }

  // 2. Delete SPA Storage Account
  if (discovered.spaBucket) {
    steps.push({
      name: 'Storage Account (SPA)',
      resource: discovered.spaBucketName,
      execute: () =>
        deleteStorageAccount({
          credentials,
          resourceGroupName,
          storageAccountName: discovered.spaBucketName,
        }),
    });
  }

  // 3. Delete PostgreSQL database (on the server discovery checked, honors database.serverName)
  if (discovered.hasDatabase) {
    const serverName = discovered.postgresServerName;
    steps.push({
      name: 'PostgreSQL database',
      resource: serviceName,
      execute: () =>
        deleteDatabase({
          credentials,
          resourceGroupName,
          serverName,
          databaseName: serviceName,
        }),
    });
  }

  // 4. Sync Terraform state (uses pre-fetched passwords)
  steps.push({
    name: 'Terraform state sync',
    resource: 'infrastructure state',
    execute: async () => {
      try {
        await syncTerraformState(ctx, dbPasswords);
        return { success: true, deleted: true };
      } catch (error) {
        return {
          success: true,
          deleted: false,
          error: `Warning: ${error instanceof Error ? error.message : 'Unknown'}`,
        };
      }
    },
  });

  // 5. Delete service-scoped secrets ({project}-{service}-*): in the
  // service's own vault (kept, empty: no cost, and deleting it would
  // reserve its name for 90 days), and any left in the shared vault
  if (discovered.serviceVaultSecrets.length > 0) {
    steps.push({
      name: 'Service vault secrets',
      resource: `${discovered.serviceVaultSecrets.length} secrets`,
      execute: () =>
        deleteKeyVaultSecretsByPrefix({
          credentials,
          vaultName: buildKeyVaultName(projectName, targetEnv, serviceName),
          prefix: `${projectName}-${serviceName}-`,
        }).then((result) => ({
          success: result.success,
          deleted: result.totalDeleted > 0,
          error: result.error,
        })),
    });
  }
  if (discovered.secrets.length > 0) {
    steps.push({
      name: 'Service-scoped secrets',
      resource: `${discovered.secrets.length} secrets`,
      execute: () =>
        deleteKeyVaultSecretsByPrefix({
          credentials,
          vaultName,
          prefix: `${projectName}-${serviceName}-`,
        }).then((result) => ({
          success: result.success,
          deleted: result.totalDeleted > 0,
          error: result.error,
        })),
    });
  }

  // 6. Delete shared secrets for this service
  steps.push({
    name: 'Shared secrets for service',
    resource: 'DB passwords, API key, service URL',
    execute: () =>
      deleteSharedSecretsForService({
        projectName,
        serviceName,
        hasDatabase: discovered.hasDatabase,
        credentials,
        vaultName,
      }).then((result) => ({
        success: result.success,
        deleted: result.deleted.length > 0,
        error: result.error,
      })),
  });

  return steps;
}
