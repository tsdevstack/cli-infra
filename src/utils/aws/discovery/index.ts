/**
 * AWS Discovery Utilities
 *
 * Check if AWS resources exist.
 * Used by infra:list-deployed and infra:service-status commands.
 */

export { listEcsServices } from './list-ecs-services';
export type {
  ListEcsServicesOptions,
  ListEcsServicesResult,
  EcsServiceInfo,
} from './list-ecs-services';

export { listAppRunnerServices } from './list-apprunner-services';
export type {
  ListAppRunnerServicesOptions,
  ListAppRunnerServicesResult,
  AppRunnerServiceInfo,
} from './list-apprunner-services';

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

export { discoverServiceResources } from './discover-service-resources';
export type {
  DiscoverServiceResourcesOptions,
  DiscoveredResources,
} from './discover-service-resources';

export { getEcsService } from './get-ecs-service';
export type {
  GetEcsServiceOptions,
  GetEcsServiceResult,
  EcsServiceDetails,
} from './get-ecs-service';

export { getAppRunnerService } from './get-apprunner-service';
export type {
  GetAppRunnerServiceOptions,
  GetAppRunnerServiceResult,
  AppRunnerServiceDetails,
} from './get-apprunner-service';

export { bucketExists } from './bucket-exists';
export type { BucketExistsOptions, BucketExistsResult } from './bucket-exists';

export { listSecretsByPrefix } from './list-secrets-by-prefix';
export type {
  ListSecretsByPrefixOptions,
  ListSecretsByPrefixResult,
  SecretInfo,
} from './list-secrets-by-prefix';

export { discoverCoupledWorkers } from './discover-coupled-workers';
export type { DiscoverCoupledWorkersOptions } from './discover-coupled-workers';
