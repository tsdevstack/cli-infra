/**
 * Delete Utilities
 *
 * GCP resource deletion with idempotency (NOT_FOUND = success).
 * Used by infra:remove-service command.
 */

export { deleteCloudRunService } from './delete-cloud-run-service';
export type {
  DeleteCloudRunServiceOptions,
  DeleteResult,
} from './delete-cloud-run-service';

export { deleteBucket } from './delete-bucket';
export type {
  DeleteBucketOptions,
  DeleteBucketResult,
} from './delete-bucket';

export { deleteSecretsByPrefix } from './delete-secrets-by-prefix';
export type {
  DeleteSecretsByPrefixOptions,
  DeleteSecretsByPrefixResult,
  DeletedSecretInfo,
} from './delete-secrets-by-prefix';

export { deleteDatabase } from './delete-database';
export type {
  DeleteDatabaseOptions,
  DeleteDatabaseResult,
} from './delete-database';

export { deleteDatabaseUser } from './delete-database-user';
export type {
  DeleteDatabaseUserOptions,
  DeleteDatabaseUserResult,
} from './delete-database-user';

export { deleteServiceAccount } from './delete-service-account';
export type {
  DeleteServiceAccountOptions,
  DeleteServiceAccountResult,
} from './delete-service-account';

export { invalidateCdnCache } from './invalidate-cdn-cache';
export type {
  InvalidateCdnCacheOptions,
  InvalidateCdnCacheResult,
} from './invalidate-cdn-cache';

export { deleteSharedSecretsForService } from './delete-shared-secrets-for-service';
export type {
  DeleteSharedSecretsOptions,
  DeleteSharedSecretsResult,
} from './delete-shared-secrets-for-service';

export { deleteSchedulerJob } from './delete-scheduler-job';
export type {
  DeleteSchedulerJobOptions,
  DeleteSchedulerJobResult,
} from './delete-scheduler-job';