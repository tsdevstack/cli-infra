/**
 * Azure Command utilities
 */

export { azureBootstrap } from './bootstrap';
export { azureGenerate } from './generate';
export { azurePlan } from './plan';
export { azureDeploy } from './deploy';
export { azureDestroy } from './destroy';
export {
  azureServiceStatus,
  selectServiceInteractiveAzure,
} from './service-status';
export { azureListDeployed } from './list-deployed';
export { azureRemoveService } from './remove-service';
export {
  azureDeployScheduler,
  type DeploySchedulerOptions,
} from './deploy-scheduler';
export {
  azureDeploySchedulers,
  type DeploySchedulersOptions,
} from './deploy-schedulers';
export { azureListSchedulers } from './list-schedulers';
export { azureRunCron } from './run-cron';
export { azureDeployCronJobs } from './deploy-cron-jobs';
export { azureDeployCronJob } from './deploy-cron-job';
export { buildAzureScheduledJobResourceName } from './build-azure-scheduled-job-resource-name';
export { azureRemoveScheduler } from './remove-scheduler';
export {
  azureDeployServices,
  type DeployServicesOptions,
} from './deploy-services';
export { deployContainerAppServices } from './deploy-container-app-services';
export { deploySpaServices } from './deploy-spa-services';
export { getAzureKongRegistryInfo } from './get-kong-registry-info';
export { pushAzureKongImage } from './push-kong-image';
export { azureKongDeploy } from './deploy-kong';
export { azureDeployWorker } from './deploy-worker';
export { buildAzureBackendEnv } from './build-azure-backend-env';
export {
  azureRemoveDetachedWorker,
  selectWorkerInteractiveAzure,
} from './remove-detached-worker';
export { azureDbMigratePlan } from './db-migrate-plan';
export { azureDbMigrateRun } from './db-migrate-run';
export { azureInitCi } from './init-ci';
export { azureGenerateCiWorkflows } from './generate-ci-workflows';
export type {
  AzureCommandContext,
  PlanOptions,
  DeployOptions,
  DestroyOptions,
} from './types';
