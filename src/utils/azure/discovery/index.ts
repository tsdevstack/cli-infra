/**
 * Azure Discovery Module
 *
 * Functions for discovering deployed Azure resources.
 * Used by service-status, list-deployed, and remove-service commands.
 */

export { getContainerApp } from './get-container-app';
export type {
  ContainerAppInfo,
  GetContainerAppResult,
} from './get-container-app';

export { listContainerApps } from './list-container-apps';
export type {
  ContainerAppListItem,
  ListContainerAppsResult,
} from './list-container-apps';

export { listAppServices } from './list-app-services';
export type {
  AppServiceListItem,
  ListAppServicesResult,
} from './list-app-services';

export { storageAccountExists } from './storage-account-exists';

export { listSpaStorageAccounts } from './list-spa-storage-accounts';
export type { SpaStorageAccountInfo } from './list-spa-storage-accounts';

export { listKeyVaultSecretsByPrefix } from './list-keyvault-secrets-by-prefix';

export { databaseExists } from './database-exists';
export type {
  DatabaseExistsOptions,
  DatabaseExistsResult,
} from './database-exists';

export { discoverServiceResources } from './discover-service-resources';
export type {
  DiscoverServiceResourcesOptions,
  DiscoveredResources,
} from './discover-service-resources';

export { discoverDeployedServices } from './discover-deployed-services';
export type {
  DeployedServiceInfo,
  DiscoverDeployedServicesResult,
} from './discover-deployed-services';

export { discoverCoupledWorkers } from './discover-coupled-workers';
export type { CoupledWorkerInfo } from './discover-coupled-workers';
