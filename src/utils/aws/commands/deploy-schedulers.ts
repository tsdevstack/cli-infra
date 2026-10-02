/**
 * AWS Deploy Schedulers Handler
 *
 * Deploys all scheduled jobs to EventBridge Scheduler.
 * Runs targeted terraform apply on each aws_scheduler_schedule resource.
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../../../context';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { executeTerraform } from '../terraform';
import {
  buildAwsTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { buildScheduledJobKey } from './build-scheduled-job-key';
import type { AWSCommandContext } from './types';

export interface DeploySchedulersOptions {
  autoApprove?: boolean;
}

/**
 * Deploy all scheduled jobs to EventBridge Scheduler
 */
export async function awsDeploySchedulers(
  ctx: AWSCommandContext,
  options: DeploySchedulersOptions,
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
      'infra:deploy-schedulers',
      'Add scheduledJobs to .tsdevstack/infrastructure.json',
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
      'infra:deploy-schedulers',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Check if eventbridge.tf exists
  const eventbridgeTfPath = path.join(terraformDir, 'eventbridge.tf');
  if (!fs.existsSync(eventbridgeTfPath)) {
    throw new CliError(
      'eventbridge.tf not found',
      'infra:deploy-schedulers',
      `Run npx tsdevstack infra:generate --env ${targetEnv} first`,
    );
  }

  // Log deployment info
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Jobs to deploy: ${scheduledJobs.length}`);
  for (const job of scheduledJobs) {
    logger.info(
      `  - ${job.name} (${job.schedule}) → ${job.targetService}${job.endpoint}`,
    );
  }
  logger.newline();

  // Build Terraform environment
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);

  // Run terraform init
  logger.info('Initializing...');
  const initResult = await executeTerraform('init', {
    workDir: terraformDir,
    env: tfEnv,
    reconfigure: true,
  });

  if (!initResult.success) {
    throw new CliError(
      'Terraform init failed',
      'infra:deploy-schedulers',
      initResult.error || 'Check the output above for details',
    );
  }

  // Deploy each job with targeted apply
  logger.newline();
  logger.info('Deploying scheduled jobs...');
  logger.newline();

  const tfVarsFile = path.join(terraformDir, 'terraform.tfvars');

  for (const job of scheduledJobs) {
    logger.info(`  Deploying ${job.name}...`);

    const jobKey = buildScheduledJobKey(job.targetService, job.name);
    const applyResult = await executeTerraform('apply', {
      workDir: terraformDir,
      env: tfEnv,
      autoApprove: options.autoApprove ?? isCIEnv(),
      target: `aws_scheduler_schedule.job["${jobKey}"]`,
      varFile: tfVarsFile,
    });

    if (!applyResult.success) {
      throw new CliError(
        `Failed to deploy scheduled job: ${job.name}`,
        'infra:deploy-schedulers',
        applyResult.error || 'Check the output above for details',
      );
    }

    logger.success(`  ✓ ${job.name} deployed`);
  }

  logger.newline();
  logger.complete(
    `All ${scheduledJobs.length} scheduled jobs deployed successfully!`,
  );
}
