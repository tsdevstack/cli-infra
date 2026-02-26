/**
 * Azure CI Initialization
 *
 * Initializes CI/CD for Azure deployments with GitHub Actions.
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
  REMOVE_SERVICE_WORKFLOW_FILENAME,
} from '../../../constants';
import {
  generatePrWorkflow,
  generateDeployWorkflow,
  generateDeployServicesWorkflow,
  generateDeployInfraWorkflow,
  generateDeployKongWorkflow,
  generateRemoveServiceWorkflow,
  printSetupInstructions,
} from '../ci';
import type { CIConfig } from '../ci';

/**
 * Initialize Azure CI/CD configuration
 */
export async function azureInitCi(): Promise<void> {
  const {
    logger,
    loadFrameworkConfig,
    findProjectRoot,
    writeJsonFile,
    isFile,
    ensureDirectory,
    writeTextFile,
    TSDEVSTACK_DIR,
    loadCredentialsFile,
    getAvailableEnvironments,
    loadUserSecrets,
    CliError,
  } = getContext();

  const projectRoot = findProjectRoot();
  const config = loadFrameworkConfig();
  const projectName = config.project.name;

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
      'Use infra:generate-ci to regenerate workflows, or delete .tsdevstack/ci.json to start fresh',
    );
  }

  // Get available environments from credentials
  let azureCredentials: Record<string, unknown> | null = null;
  try {
    azureCredentials = loadCredentialsFile(projectRoot, 'azure');
  } catch {
    // No credentials yet
  }
  const environments = azureCredentials
    ? getAvailableEnvironments(projectRoot, 'azure')
    : [];

  if (environments.length === 0) {
    throw new CliError(
      'No environments configured',
      'infra:init-ci',
      'Run cloud:init --azure first to configure cloud credentials',
    );
  }

  // Create CI config
  const ciConfig: CIConfig = {
    provider: 'github',
    environments,
  };

  // Write ci.json
  logger.info('Creating CI configuration...');
  writeJsonFile(ciConfigPath, ciConfig);
  logger.info(`  Created ${TSDEVSTACK_DIR}/${CI_CONFIG_FILENAME}`);

  // Create workflows directory
  const workflowsDir = path.join(projectRoot, GITHUB_WORKFLOWS_DIR);
  ensureDirectory(workflowsDir);

  // Generate PR workflow
  const prWorkflowPath = path.join(workflowsDir, PR_WORKFLOW_FILENAME);
  writeTextFile(prWorkflowPath, generatePrWorkflow());
  logger.info(`  Created ${GITHUB_WORKFLOWS_DIR}/${PR_WORKFLOW_FILENAME}`);

  // Generate deploy workflow
  const deployWorkflowPath = path.join(workflowsDir, DEPLOY_WORKFLOW_FILENAME);
  writeTextFile(deployWorkflowPath, generateDeployWorkflow(ciConfig));
  logger.info(`  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_WORKFLOW_FILENAME}`);

  // Generate deploy-services workflow (with service booleans)
  const deployServicesPath = path.join(
    workflowsDir,
    DEPLOY_SERVICES_WORKFLOW_FILENAME,
  );
  writeTextFile(
    deployServicesPath,
    generateDeployServicesWorkflow(ciConfig, config.services),
  );
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_SERVICES_WORKFLOW_FILENAME}`,
  );

  // Generate deploy-infra workflow
  const deployInfraPath = path.join(
    workflowsDir,
    DEPLOY_INFRA_WORKFLOW_FILENAME,
  );
  writeTextFile(deployInfraPath, generateDeployInfraWorkflow(ciConfig));
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_INFRA_WORKFLOW_FILENAME}`,
  );

  // Generate deploy-kong workflow
  const deployKongPath = path.join(workflowsDir, DEPLOY_KONG_WORKFLOW_FILENAME);
  writeTextFile(deployKongPath, generateDeployKongWorkflow(ciConfig));
  logger.info(
    `  Created ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_KONG_WORKFLOW_FILENAME}`,
  );

  // Generate remove-service workflow
  const removeServicePath = path.join(
    workflowsDir,
    REMOVE_SERVICE_WORKFLOW_FILENAME,
  );
  writeTextFile(removeServicePath, generateRemoveServiceWorkflow(ciConfig));
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

  logger.info('=== Next Steps ===');
  logger.newline();
  logger.info('1. Commit the generated files');
  logger.info('2. Set user secrets for each environment');
  logger.info('3. Push to GitHub to trigger PR checks');
  logger.info('4. Use Actions > Deploy workflow for manual deployments');
  logger.newline();
}
