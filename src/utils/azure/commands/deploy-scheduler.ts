/**
 * Azure Deploy Scheduler Handler
 *
 * Deploys a single scheduled job using targeted Terraform apply on
 * azurerm_container_app_job resources.
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { executeTerraform } from '../terraform';
import {
  buildAzureTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import { buildScheduledJobKey } from './build-scheduled-job-key';
import type { AzureCommandContext } from './types';

export interface DeploySchedulerOptions {
  job?: string;
  autoApprove?: boolean;
}

/**
 * Deploy a single scheduled job to Azure Container App Jobs
 */
export async function azureDeployScheduler(
  ctx: AzureCommandContext,
  options: DeploySchedulerOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();
  const runtime = buildRuntime();

  checkTerraformInstalled(runtime);

  const { projectRoot, targetEnv, credentials } = ctx;

  // Load infrastructure config and get scheduled jobs
  const infraConfig = loadInfrastructureConfig();
  const scheduledJobs = getScheduledJobs(infraConfig, targetEnv);

  if (scheduledJobs.length === 0) {
    throw new CliError(
      `No scheduled jobs configured for environment '${targetEnv}'`,
      'infra:deploy-scheduler',
      'Add scheduledJobs to .tsdevstack/infrastructure.json',
    );
  }

  // Determine which job to deploy
  let jobName = options.job;

  if (!jobName) {
    if (isCIEnv()) {
      throw new CliError(
        'Missing required --job option',
        'infra:deploy-scheduler',
        'In CI mode, --job is required',
      );
    }

    // Interactive mode - prompt for job selection
    const { selectedJob } = await inquirer.prompt<{ selectedJob: string }>([
      {
        type: 'list',
        name: 'selectedJob',
        message: 'Select scheduled job to deploy:',
        choices: scheduledJobs.map((j) => ({
          name: `${j.name} (${j.schedule}) → ${j.targetService}${j.endpoint}`,
          value: j.name,
        })),
      },
    ]);
    jobName = selectedJob;
  }

  // Find the job config
  const jobConfig = scheduledJobs.find((j) => j.name === jobName);
  if (!jobConfig) {
    throw new CliError(
      `Scheduled job '${jobName}' not found in config`,
      'infra:deploy-scheduler',
      `Available jobs: ${scheduledJobs.map((j) => j.name).join(', ')}`,
    );
  }

  // Validate Terraform directory exists
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'infra:deploy-scheduler',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Check if scheduled-jobs.tf exists
  const scheduledJobsTfPath = path.join(terraformDir, 'scheduled-jobs.tf');
  if (!fs.existsSync(scheduledJobsTfPath)) {
    throw new CliError(
      'scheduled-jobs.tf not found',
      'infra:deploy-scheduler',
      `Run npx tsdevstack infra:generate --env ${targetEnv} first`,
    );
  }

  // Log deployment info
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Job: ${jobConfig.name}`);
  logger.info(`Schedule: ${jobConfig.schedule}`);
  logger.info(`Target: ${jobConfig.targetService}${jobConfig.endpoint}`);
  logger.newline();

  // Build Terraform environment
  const tfEnv = buildAzureTerraformEnv(runtime, credentials);

  // Run terraform init
  logger.info('Initializing...');
  const initResult = await executeTerraform('init', {
    workDir: terraformDir,
    env: tfEnv,
  });

  if (!initResult.success) {
    throw new CliError(
      'Terraform init failed',
      'infra:deploy-scheduler',
      initResult.error || 'Check the output above for details',
    );
  }

  // Run targeted terraform apply
  logger.newline();
  logger.info(`Deploying ${jobConfig.name}...`);
  logger.newline();

  const jobKey = buildScheduledJobKey(jobConfig.targetService, jobConfig.name);
  const tfVarsFile = path.join(terraformDir, 'terraform.tfvars');
  const applyResult = await executeTerraform('apply', {
    workDir: terraformDir,
    env: tfEnv,
    autoApprove: options.autoApprove ?? isCIEnv(),
    targets: [
      'random_password.job_secret',
      'azurerm_key_vault_secret.job_secret',
      `azurerm_container_app_job.scheduled_jobs["${jobKey}"]`,
    ],
    varFile: tfVarsFile,
  });

  if (!applyResult.success) {
    throw new CliError(
      `Failed to deploy scheduled job: ${jobConfig.name}`,
      'infra:deploy-scheduler',
      applyResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.complete(`Scheduled job '${jobConfig.name}' deployed successfully!`);
}
