/**
 * Build Deletion Steps
 *
 * Build deletion steps based on discovered resources.
 *
 * Order is critical:
 * 0. Coupled workers (must be deleted before service account)
 * 1. Cloud Run (stops traffic)
 * 2. SPA bucket
 * 3. The migration job, then the database save (db-init export, to the
 *    exports bucket; left out with --skip-export)
 * 3b. Database and roles (db-init remove mode, in SQL: the database, the
 *    owner and the app role). Cloud SQL's API refuses a database owned by a
 *    role outside its admin group, which db-init's owner is.
 * 3c. Database and Cloud SQL user through the API: only an environment
 *     infra:deploy has not converted yet (no db-init) still has them
 * 5. Service account, and the migration jobs' account
 * 6. CDN cache invalidation
 * 7. Secrets (last)
 *
 * Terraform's state is left as it is: every later plan, deploy or destroy
 * refreshes it first.
 */

import type { DeletionStep, DeletionStepResult } from './types';
import type { GCPCommandContext } from '../commands/types';
import type { DiscoveredResources, CoupledWorkerInfo } from '../discovery';
import {
  deleteCloudRunService,
  deleteCloudRunJob,
  deleteBucket,
  deleteSecretsByPrefix,
  deleteSharedSecretsForService,
  deleteDatabase,
  deleteDatabaseUser,
  dropDatabaseRoles,
  deleteServiceAccount,
  invalidateCdnCache,
} from '../delete';

export interface BuildDeletionStepsOptions {
  ctx: GCPCommandContext;
  serviceName: string;
  discovered: DiscoveredResources;
  projectName: string;
  coupledWorkers: CoupledWorkerInfo[];
  /**
   * Saves the database to the exports bucket (infra:restore-database brings
   * it back); left out with --skip-export
   */
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
    coupledWorkers,
    saveDatabase,
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
          serviceName: worker.cloudRunName,
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
      resource: discovered.cloudRunServiceName,
      execute: () =>
        deleteCloudRunService({
          serviceName: discovered.cloudRunServiceName,
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

  // 3. Delete the migration job (infra:db-migrate-run keeps it for reuse).
  // Before the database: a rerun after a failed database step still finds
  // the database, so it gets here again.
  if (discovered.database) {
    const jobName = discovered.migrationJobName;
    steps.push({
      name: 'Migration job',
      resource: jobName,
      execute: () =>
        deleteCloudRunJob({ jobName, projectId, region, credentials }),
    });
  }

  // 3a. Save the database, right before the drop: the service and its
  // workers are gone, so nothing writes in between. A failed save stops
  // here, with the database untouched.
  if (discovered.database && saveDatabase) {
    steps.push({
      name: 'Database save',
      label: 'Saving the database',
      doneText: 'Saved',
      skippedText: 'Not saved: removing without its data',
      resource: serviceName,
      execute: saveDatabase,
    });
  }

  // 3b. The database, the owner and the app role, in SQL (db-init remove)
  if (discovered.database) {
    steps.push({
      name: 'Database and roles',
      resource: `${serviceName}, ${serviceName}_app`,
      execute: () => dropDatabaseRoles({ ctx, serviceName }),
    });
  }

  // 3c. Delete database through the API (gone already after 3b, except in an
  // environment without db-init)
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

  // 4. Delete the Cloud SQL user (gone already after 3a, except in an
  // environment without db-init)
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

  // 5b. The account its migration jobs ran as
  if (discovered.migrationServiceAccount) {
    steps.push({
      name: 'Migrations service account',
      resource: discovered.migrationServiceAccountEmail,
      execute: () =>
        deleteServiceAccount({
          serviceAccountEmail: discovered.migrationServiceAccountEmail,
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

  // 7. Delete service-scoped secrets (tsdevstack-{service}-*)
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
