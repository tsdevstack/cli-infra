/**
 * Build Deletion Steps (Azure)
 *
 * Build deletion steps based on discovered resources.
 *
 * Order is critical:
 * 1. Coupled workers (Container Apps)
 * 2. Container App (stop traffic)
 * 3. SPA Storage Account
 * 4. Migration job, then the database save (db-init export), then the
 *    database and its roles in SQL (db-init remove),
 *    then the PostgreSQL database through the API (only an environment
 *    without db-init still has it)
 * 5. Service-scoped Key Vault secrets
 * 6. Shared secrets cleanup
 *
 * Terraform's state is left as it is: every later plan, deploy or destroy
 * refreshes it first.
 */

import type { DeletionStep, DeletionStepResult } from './types';
import type { AzureCommandContext } from '../commands/types';
import type { DiscoveredResources, CoupledWorkerInfo } from '../discovery';
import {
  deleteContainerApp,
  deleteContainerAppJob,
  deleteStorageAccount,
  deleteDatabase,
  deleteKeyVaultSecretsByPrefix,
  deleteSharedSecretsForService,
  dropDatabaseRoles,
  deleteMigrationDatabaseUrl,
} from '../delete';
import { AZURE_MIGRATION_JOB_PREFIX } from '../../../constants';

export interface BuildDeletionStepsOptions {
  ctx: AzureCommandContext;
  serviceName: string;
  discovered: DiscoveredResources;
  projectName: string;
  targetEnv: string;
  coupledWorkers: CoupledWorkerInfo[];
  /** Saves the database before it is dropped (left out: --skip-export) */
  saveDatabase?: () => Promise<DeletionStepResult>;
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
    coupledWorkers,
    saveDatabase,
  } = options;
  const { credentials } = ctx;
  const resourceGroupName = `${projectName}-${targetEnv}-rg`;
  const { vaultName } = discovered;
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

  // 3. Delete the migration job (infra:db-migrate-run keeps it for reuse).
  // Before the database: a rerun after a failed database step still finds
  // the database, so it gets here again.
  if (discovered.hasDatabase) {
    const jobName = `${AZURE_MIGRATION_JOB_PREFIX}${serviceName}`;
    steps.push({
      name: 'Migration job',
      resource: jobName,
      execute: () =>
        deleteContainerAppJob({ credentials, resourceGroupName, jobName }),
    });
  }

  // 3a. Save the database, right before the drop: the service, its workers
  // and its migration job are gone, so nothing writes in between. A failed
  // save stops here, with the database untouched.
  if (discovered.hasDatabase && saveDatabase) {
    steps.push({
      name: 'Database save',
      label: 'Saving the database',
      doneText: 'Saved',
      skippedText: 'Not saved: removing without its data',
      resource: serviceName,
      execute: saveDatabase,
    });
  }

  // 3b. The database, the owner and the app role, in SQL (db-init remove),
  // the same as on GCP and AWS
  if (discovered.hasDatabase) {
    steps.push({
      name: 'Database and roles',
      resource: `${serviceName}, ${serviceName}_app`,
      execute: () => dropDatabaseRoles({ ctx, serviceName }),
    });
  }

  // 3c. Delete PostgreSQL database through the API (gone already after 3b,
  // except in an environment without db-init; on the server discovery
  // checked, honors database.serverName)
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

  // 3d. The owner's URL in the database jobs' vault
  if (discovered.hasDatabase) {
    steps.push({
      name: 'Migration URL',
      resource: `${serviceName} (database jobs vault)`,
      execute: () => deleteMigrationDatabaseUrl({ ctx, serviceName }),
    });
  }

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
          vaultName: discovered.serviceVaultName,
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
