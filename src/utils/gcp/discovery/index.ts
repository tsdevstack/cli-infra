/**
 * Discovery Utilities
 *
 * Check if GCP resources exist before attempting deletion.
 * Used by infra:remove-service command for dry-run and status checking.
 */

export { discoverServiceResources } from './discover-service-resources';
export type {
  DiscoverServiceResourcesOptions,
  DiscoveredResources,
} from './discover-service-resources';

export { cloudRunServiceExists } from './cloud-run-service-exists';
export type {
  CloudRunServiceExistsOptions,
  CloudRunServiceExistsResult,
} from './cloud-run-service-exists';

export { bucketExists } from './bucket-exists';
export type { BucketExistsOptions, BucketExistsResult } from './bucket-exists';

export { listSecretsByPrefix } from './list-secrets-by-prefix';
export type {
  ListSecretsByPrefixOptions,
  ListSecretsByPrefixResult,
  SecretInfo,
} from './list-secrets-by-prefix';

export { serviceAccountExists } from './service-account-exists';
export type {
  ServiceAccountExistsOptions,
  ServiceAccountExistsResult,
} from './service-account-exists';

export { databaseExists } from './database-exists';
export type {
  DatabaseExistsOptions,
  DatabaseExistsResult,
} from './database-exists';

export { listCloudRunServices } from './list-cloud-run-services';
export type {
  ListCloudRunServicesOptions,
  ListCloudRunServicesResult,
  CloudRunServiceInfo,
} from './list-cloud-run-services';

export { listSpaBuckets } from './list-spa-buckets';
export type {
  ListSpaBucketsOptions,
  ListSpaBucketsResult,
  SpaBucketInfo,
} from './list-spa-buckets';

export { discoverDeployedServices } from './discover-deployed-services';
export type {
  DiscoverDeployedServicesOptions,
  DiscoverDeployedServicesResult,
  DeployedServiceInfo,
} from './discover-deployed-services';

export { discoverCoupledWorkers } from './discover-coupled-workers';
export type {
  DiscoverCoupledWorkersOptions,
  CoupledWorkerInfo,
} from './discover-coupled-workers';