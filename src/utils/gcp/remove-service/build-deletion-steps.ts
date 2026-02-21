/**
 * Build Deletion Steps
 *
 * Build deletion steps based on discovered resources.
 *
 * Order is critical:
 * 0. Coupled workers (must be deleted before service account)
 * 1. Cloud Run (stops traffic)
 * 2. SPA bucket
 * 3. Database
 * 4. Database user
 * 5. Service account
 * 6. CDN cache invalidation
 * 7. Terraform state sync (BEFORE secrets - needs db passwords from Secret Manager)
 * 8. Secrets (LAST - after TF sync so passwords are still available)
 */

import type { DeletionStep } from './types';
import type { GCPCommandContext } from '../commands/types';
import type { DiscoveredResources, CoupledWorkerInfo } from '../discovery';
import {
  deleteCloudRunService,
  deleteBucket,
  deleteSecretsByPrefix,
  deleteSharedSecretsForService,
  deleteDatabase,
  deleteDatabaseUser,
  deleteServiceAccount,
  invalidateCdnCache,
} from '../delete';
import { syncTerraformState } from './sync-terraform-state';

export interface BuildDeletionStepsOptions {
  ctx: GCPCommandContext;
  serviceName: string;
  discovered: DiscoveredResources;
  projectName: string;
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
    dbPasswords,
    coupledWorkers,
  } = options;
  const { credentials } = ctx;
  const projectId = credentials.project_id;
  const region = credentials.region;
  const steps: DeletionStep[] = [];

  // 0. Delete coupled workers first (they share the service account)
  for (const worker of coupledWorkers) {
    steps.push({
      name: 'Coupled worker',
      resource: worker.name,
      execute: () =>
        deleteCloudRunService({
          serviceName: worker.name,
          projectId,
          region,
          credentials,
        }),
    });
  }

  // 1. Delete Cloud Run service first (stops traffic)
  if (discovered.cloudRunService) {
    steps.push({
      name: 'Cloud Run service',
      resource: serviceName,
      execute: () =>
        deleteCloudRunService({
          serviceName,
          projectId,
          region,
          credentials,
        }),
    });
  }

  // 2. Delete SPA bucket (includes files)
  if (discovered.spaBucket) {
    steps.push({
      name: 'SPA bucket',
      resource: discovered.spaBucketName,
      execute: () =>
        deleteBucket({
          bucketName: discovered.spaBucketName,
          credentials,
        }),
    });
  }

  // 3. Delete database (discovered, not from config)
  if (discovered.database) {
    const instanceName = `${projectName}-postgres`;
    steps.push({
      name: 'Cloud SQL database',
      resource: serviceName,
      execute: () =>
        deleteDatabase({
          databaseName: serviceName,
          instanceName,
          projectId,
          credentials,
        }),
    });
  }

  // 4. Delete database user (if database was discovered)
  if (discovered.databaseUser) {
    const instanceName = `${projectName}-postgres`;
    steps.push({
      name: 'Cloud SQL user',
      resource: serviceName,
      execute: () =>
        deleteDatabaseUser({
          userName: serviceName,
          instanceName,
          projectId,
          credentials,
        }),
    });
  }

  // 5. Delete service account
  if (discovered.serviceAccount) {
    steps.push({
      name: 'Service Account',
      resource: discovered.serviceAccountEmail,
      execute: () =>
        deleteServiceAccount({
          serviceAccountEmail: discovered.serviceAccountEmail,
          projectId,
          credentials,
        }),
    });
  }

  // 6. Invalidate CDN cache (for SPA - based on discovered bucket, not config type)
  if (discovered.spaBucket) {
    steps.push({
      name: 'CDN cache invalidation',
      resource: 'url-map',
      execute: () =>
        invalidateCdnCache({
          urlMapName: `${projectName}-url-map`,
          projectId,
          credentials,
        }).then((result) => ({
          success: result.success,
          deleted: result.success,
          error: result.error,
        })),
    });
  }

  // 7. Sync Terraform state (uses pre-fetched passwords)
  steps.push({
    name: 'Terraform state sync',
    resource: 'infrastructure state',
    execute: async () => {
      try {
        await syncTerraformState(ctx, dbPasswords);
        return { success: true, deleted: true };
      } catch (error) {
        // TF sync failure shouldn't block the removal
        return {
          success: true,
          deleted: false,
          error: `Warning: ${error instanceof Error ? error.message : 'Unknown'}`,
        };
      }
    },
  });

  // 8. Delete service-scoped secrets (tsdevstack-{service}-*)
  if (discovered.secrets.length > 0) {
    steps.push({
      name: 'Service-scoped secrets',
      resource: `${discovered.secrets.length} secrets`,
      execute: () =>
        deleteSecretsByPrefix({
          projectId,
          prefix: `${projectName}-${serviceName}-`,
          credentials,
        }).then((result) => ({
          success: result.success,
          deleted: result.totalDeleted > 0,
          error: result.error,
        })),
    });
  }

  // 9. Delete shared secrets for this service (DB_*, *_API_KEY, *_URL)
  // These are stored as tsdevstack-shared-{KEY} and need explicit cleanup
  steps.push({
    name: 'Shared secrets for service',
    resource: 'DB passwords, API key, service URL',
    execute: () =>
      deleteSharedSecretsForService({
        projectId,
        projectName,
        serviceName,
        hasDatabase: discovered.database,
        credentials,
      }).then((result) => ({
        success: result.success,
        deleted: result.deleted.length > 0,
        error: result.error,
      })),
  });

  return steps;
}
