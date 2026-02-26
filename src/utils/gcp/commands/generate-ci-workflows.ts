/**
 * GCP CI Workflow Generation
 *
 * Generates GitHub Actions workflows for GCP deployments.
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
  DEPLOY_SCHEDULED_JOBS_WORKFLOW_FILENAME,
  REMOVE_SERVICE_WORKFLOW_FILENAME,
  REMOVE_DETACHED_WORKER_WORKFLOW_FILENAME,
} from '../../../constants';
import {
  generatePrWorkflow,
  generateDeployWorkflow,
  generateDeployServicesWorkflow,
  generateDeployInfraWorkflow,
  generateDeployKongWorkflow,
  generateDeployLbWorkflow,
  generateDeployScheduledJobsWorkflow,
  generateRemoveServiceWorkflow,
  generateRemoveDetachedWorkerWorkflow,
} from '../ci';
import type { CIConfig } from '../ci';

/**
 * Generate GCP CI workflows
 */
export async function gcpGenerateCiWorkflows(): Promise<void> {
  const {
    logger,
    findProjectRoot,
    readJsonFile,
    isFile,
    ensureDirectory,
    writeTextFile,
    loadFrameworkConfig,
    TSDEVSTACK_DIR,
    CliError,
  } = getContext();

  const projectRoot = findProjectRoot();

  // Load ci.json
  const ciConfigPath = path.join(
    projectRoot,
    TSDEVSTACK_DIR,
    CI_CONFIG_FILENAME,
  );
  if (!isFile(ciConfigPath)) {
    throw new CliError(
      'CI not initialized',
      'infra:generate-ci',
      'Run infra:init-ci --github first to initialize CI/CD',
    );
  }

  const ciConfig = readJsonFile<CIConfig>(ciConfigPath);
  if (!ciConfig) {
    throw new CliError(
      'Failed to load CI configuration',
      'infra:generate-ci',
      `Check ${TSDEVSTACK_DIR}/${CI_CONFIG_FILENAME} is valid JSON`,
    );
  }

  // Load framework config for services
  const frameworkConfig = loadFrameworkConfig();
  const services = frameworkConfig.services;

  // Create workflows directory (in case it was deleted)
  const workflowsDir = path.join(projectRoot, GITHUB_WORKFLOWS_DIR);
  ensureDirectory(workflowsDir);

  // Regenerate PR workflow
  const prWorkflowPath = path.join(workflowsDir, PR_WORKFLOW_FILENAME);
  writeTextFile(prWorkflowPath, generatePrWorkflow());
  logger.info(`  Updated ${GITHUB_WORKFLOWS_DIR}/${PR_WORKFLOW_FILENAME}`);

  // Regenerate full deploy workflow (legacy, for backwards compatibility)
  const deployWorkflowPath = path.join(workflowsDir, DEPLOY_WORKFLOW_FILENAME);
  writeTextFile(deployWorkflowPath, generateDeployWorkflow(ciConfig));
  logger.info(`  Updated ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_WORKFLOW_FILENAME}`);

  // Regenerate deploy-services workflow (with service booleans)
  const deployServicesPath = path.join(
    workflowsDir,
    DEPLOY_SERVICES_WORKFLOW_FILENAME,
  );
  writeTextFile(
    deployServicesPath,
    generateDeployServicesWorkflow(ciConfig, services),
  );
  logger.info(
    `  Updated ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_SERVICES_WORKFLOW_FILENAME}`,
  );

  // Regenerate deploy-infra workflow
  const deployInfraPath = path.join(
    workflowsDir,
    DEPLOY_INFRA_WORKFLOW_FILENAME,
  );
  writeTextFile(deployInfraPath, generateDeployInfraWorkflow(ciConfig));
  logger.info(
    `  Updated ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_INFRA_WORKFLOW_FILENAME}`,
  );

  // Regenerate deploy-kong workflow
  const deployKongPath = path.join(workflowsDir, DEPLOY_KONG_WORKFLOW_FILENAME);
  writeTextFile(deployKongPath, generateDeployKongWorkflow(ciConfig));
  logger.info(
    `  Updated ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_KONG_WORKFLOW_FILENAME}`,
  );

  // Regenerate deploy-lb workflow
  const deployLbPath = path.join(workflowsDir, DEPLOY_LB_WORKFLOW_FILENAME);
  writeTextFile(deployLbPath, generateDeployLbWorkflow(ciConfig));
  logger.info(
    `  Updated ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_LB_WORKFLOW_FILENAME}`,
  );

  // Regenerate deploy-scheduled-jobs workflow
  const deployScheduledJobsPath = path.join(
    workflowsDir,
    DEPLOY_SCHEDULED_JOBS_WORKFLOW_FILENAME,
  );
  writeTextFile(
    deployScheduledJobsPath,
    generateDeployScheduledJobsWorkflow(ciConfig),
  );
  logger.info(
    `  Updated ${GITHUB_WORKFLOWS_DIR}/${DEPLOY_SCHEDULED_JOBS_WORKFLOW_FILENAME}`,
  );

  // Regenerate remove-service workflow
  const removeServicePath = path.join(
    workflowsDir,
    REMOVE_SERVICE_WORKFLOW_FILENAME,
  );
  writeTextFile(removeServicePath, generateRemoveServiceWorkflow(ciConfig));
  logger.info(
    `  Updated ${GITHUB_WORKFLOWS_DIR}/${REMOVE_SERVICE_WORKFLOW_FILENAME}`,
  );

  // Regenerate remove-detached-worker workflow
  const removeDetachedWorkerPath = path.join(
    workflowsDir,
    REMOVE_DETACHED_WORKER_WORKFLOW_FILENAME,
  );
  writeTextFile(
    removeDetachedWorkerPath,
    generateRemoveDetachedWorkerWorkflow(ciConfig),
  );
  logger.info(
    `  Updated ${GITHUB_WORKFLOWS_DIR}/${REMOVE_DETACHED_WORKER_WORKFLOW_FILENAME}`,
  );
}
