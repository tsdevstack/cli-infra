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

/** Supported CI providers */
export const SUPPORTED_CI_PROVIDERS = ['github'] as const;

/** Node.js line the generated GitHub workflows run on (actions/setup-node) */
export const CI_NODE_VERSION = '24';

/** The docs site's AWS CI/CD page (the deploy role's permissions policy) */
export const AWS_CICD_DOCS_URL =
  'https://tsdevstack.dev/docs/infrastructure/providers/aws/cicd';

/**
 * Prints a repository's two GitHub IDs, which the immutable OIDC subject
 * form (repositories created after 15 July 2026) carries:
 * repo:ORG@OWNER_ID/REPO@REPO_ID:...
 */
export const GITHUB_REPO_IDS_COMMAND =
  "gh api repos/YOUR_ORG/YOUR_REPO --jq '.owner.id, .id'";
