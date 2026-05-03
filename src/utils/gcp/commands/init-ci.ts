/**
 * GCP CI Initialization
 *
 * Initializes CI/CD for GCP deployments with GitHub Actions.
 */

import * as path from 'path';
import { getContext } from '../../../context';
import {
  CI_CONFIG_FILENAME,
  GITHUB_WORKFLOWS_DIR,
  PR_WORKFLOW_FILENAME,
  DEPLOY_WORKFLOW_FILENAME,
  DEPLOY_SERVICES_WORKFLOW_FILENAME,
  DEPLOY_INFRA_WORKFLOW_FILENAME,
  DEPLOY_KONG_WORKFLOW_FILENAME,
  DEPLOY_LB_WORKFLOW_FILENAME,
  REMOVE_SERVICE_WORKFLOW_FILENAME,
} from '../../../constants';
import {
  generatePrWorkflow,
  generateDeployWorkflow,
  generateDeployServicesWorkflow,
  generateDeployInfraWorkflow,
  generateDeployKongWorkflow,
  generateDeployLbWorkflow,
  generateRemoveServiceWorkflow,
  printSetupInstructions,
} from '../ci';
import { hasProjectNpmrc } from '../../npm-auth';
import type { CIConfig } from '../ci';

/**
 * Initialize GCP CI/CD configuration
 */
export async function gcpInitCi(
  environments: string[],
  projectName: string,
): Promise<void> {
  const {
    logger,
    loadFrameworkConfig,
    findProjectRoot,
    writeJsonFile,
    isFile,
    ensureDirectory,
    writeTextFile,
    TSDEVSTACK_DIR,
    loadUserSecrets,
    CliError,
  } = getContext();

  const projectRoot = findProjectRoot();
  const config = loadFrameworkConfig();

  // Check if ci.json already exists
  const ciConfigPath = path.join(
    projectRoot,
    TSDEVSTACK_DIR,
    CI_CONFIG_FILENAME,
  );
  if (isFile(ciConfigPath)) {
    throw new CliError(
      'CI already initialized',
      'infra:init-ci',
      'Run: npx tsdevstack infra:generate-ci to regenerate workflows, or delete .tsdevstack/ci.json to start fresh',
    );
  }

  // Create CI config
  const ciConfig: CIConfig = {
    provider: 'github',
    environments,
  };

  // Write ci.json
  logger.info('Creating CI configuration...');
  writeJsonFile(ciConfigPath, { $schema: './ci.schema.json', ...ciConfig });
  logger.info(`  Created ${TSDEVSTACK_DIR}/${CI_CONFIG_FILENAME}`);

  // Auto-detect: if `.npmrc` exists at project root, expose `NPM_TOKEN`
  // to every job in the generated workflows so private-registry installs
  // (host `npm ci` and tsdevstack-spawned docker builds) can authenticate.
  const npmAuth = hasProjectNpmrc(projectRoot);
  const opts = { npmAuth };

  // Create workflows directory
  const workflowsDir = path.join(projectRoot, GITHUB_WORKFLOWS_DIR);
  ensureDirectory(workflowsDir);

  // Generate PR workflow
  const prWorkflowPath = path.join(workflowsDir, PR_WORKFLOW_FILENAME);
  writeTextFile(prWorkflowPath, generatePrWorkflow(opts));
  logger.info(`  Created ${GITHUB_WORKFLOWS_DIR}/${PR_WORKFLOW_FILENAME}`);

  // Generate deploy workflow (legacy, for backwards compatibility)
  const deployWorkflowPath = path.join(workflowsDir, DEPLOY_WORKFLOW_FILENAME);
  writeTextFile(deployWorkflowPath, generateDeployWorkflow(ciConfig, opts));
  logger.info(`  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_WORKFLOW_FILENAME}`);

  // Generate deploy-services workflow (with service booleans)
  const deployServicesPath = path.join(
    workflowsDir,
    DEPLOY_SERVICES_WORKFLOW_FILENAME,
  );
  writeTextFile(
    deployServicesPath,
    generateDeployServicesWorkflow(ciConfig, config.services, opts),
  );
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_SERVICES_WORKFLOW_FILENAME}`,
  );

  // Generate deploy-infra workflow
  const deployInfraPath = path.join(
    workflowsDir,
    DEPLOY_INFRA_WORKFLOW_FILENAME,
  );
  writeTextFile(deployInfraPath, generateDeployInfraWorkflow(ciConfig, opts));
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_INFRA_WORKFLOW_FILENAME}`,
  );

  // Generate deploy-kong workflow
  const deployKongPath = path.join(workflowsDir, DEPLOY_KONG_WORKFLOW_FILENAME);
  writeTextFile(deployKongPath, generateDeployKongWorkflow(ciConfig, opts));
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_KONG_WORKFLOW_FILENAME}`,
  );

  // Generate deploy-lb workflow
  const deployLbPath = path.join(workflowsDir, DEPLOY_LB_WORKFLOW_FILENAME);
  writeTextFile(deployLbPath, generateDeployLbWorkflow(ciConfig, opts));
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_LB_WORKFLOW_FILENAME}`,
  );

  // Generate remove-service workflow
  const removeServicePath = path.join(
    workflowsDir,
    REMOVE_SERVICE_WORKFLOW_FILENAME,
  );
  writeTextFile(
    removeServicePath,
    generateRemoveServiceWorkflow(ciConfig, opts),
  );
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${REMOVE_SERVICE_WORKFLOW_FILENAME}`,
  );

  logger.newline();
  logger.success('CI/CD initialized successfully!');

  // Get user secrets for instructions
  const userSecrets = loadUserSecrets();
  const userSecretKeys = userSecrets
    ? Object.keys(userSecrets.secrets || {})
    : [];

  // Print setup instructions
  printSetupInstructions(userSecretKeys, projectName, environments, logger);

  if (npmAuth) {
    logger.newline();
    logger.info('=== Private npm packages ===');
    logger.newline();
    logger.info(
      'Detected .npmrc at project root — generated workflows expose NPM_TOKEN to every job.',
    );
    logger.info(
      'Add NPM_TOKEN as a GitHub repository secret (single value, not per-env)',
    );
    logger.info(
      '  so that host `npm ci` and tsdevstack-spawned docker builds can install private packages.',
    );
    logger.newline();
  }

  logger.info('=== Next Steps ===');
  logger.newline();
  logger.info('1. Commit the generated files');
  logger.info('2. Set user secrets for each environment');
  logger.info('3. Push to GitHub to trigger PR checks');
  logger.info('4. Use Actions > Deploy workflow for manual deployments');
  logger.newline();
}
