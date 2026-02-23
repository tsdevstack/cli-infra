/**
 * CI/CD Constants
 */

/** CI configuration filename */
export const CI_CONFIG_FILENAME = 'ci.json';

/** GitHub workflows directory */
export const GITHUB_WORKFLOWS_DIR = '.github/workflows';

/** Generated workflow filenames */
export const PR_WORKFLOW_FILENAME = 'pr.yml';
export const DEPLOY_WORKFLOW_FILENAME = 'deploy.yml';

/** New separate workflow filenames */
export const DEPLOY_SERVICES_WORKFLOW_FILENAME = 'deploy-services.yml';
export const DEPLOY_INFRA_WORKFLOW_FILENAME = 'deploy-infra.yml';
export const DEPLOY_KONG_WORKFLOW_FILENAME = 'deploy-kong.yml';
export const DEPLOY_LB_WORKFLOW_FILENAME = 'deploy-lb.yml';
export const DEPLOY_SCHEDULED_JOBS_WORKFLOW_FILENAME =
  'deploy-scheduled-jobs.yml';
export const REMOVE_SERVICE_WORKFLOW_FILENAME = 'remove-service.yml';
export const REMOVE_DETACHED_WORKER_WORKFLOW_FILENAME =
  'remove-detached-worker.yml';

/** Framework-prefixed workflow filenames (internal development only) */
export const FRAMEWORK_DEPLOY_WORKFLOW_FILENAME = 'framework-deploy.yml';
export const FRAMEWORK_DEPLOY_SERVICES_WORKFLOW_FILENAME =
  'framework-deploy-services.yml';
export const FRAMEWORK_DEPLOY_INFRA_WORKFLOW_FILENAME =
  'framework-deploy-infra.yml';
export const FRAMEWORK_DEPLOY_KONG_WORKFLOW_FILENAME =
  'framework-deploy-kong.yml';
export const FRAMEWORK_DEPLOY_LB_WORKFLOW_FILENAME = 'framework-deploy-lb.yml';
export const FRAMEWORK_DEPLOY_SCHEDULED_JOBS_WORKFLOW_FILENAME =
  'framework-deploy-scheduled-jobs.yml';
export const FRAMEWORK_REMOVE_SERVICE_WORKFLOW_FILENAME =
  'framework-remove-service.yml';
export const FRAMEWORK_REMOVE_DETACHED_WORKER_WORKFLOW_FILENAME =
  'framework-remove-detached-worker.yml';

/** Supported CI providers */
export const SUPPORTED_CI_PROVIDERS = ['github'] as const;
