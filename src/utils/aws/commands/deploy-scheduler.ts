/**
 * AWS Deploy Scheduler Handler
 *
 * Deploys a single scheduled job to EventBridge Scheduler using targeted
 * Terraform apply. For a cron job, the apply also creates its task
 * definition, log group and the scheduler role; then its task definition
 * gets a revision with the image the service runs and the schedule is
 * pointed at it (awsDeployCronJobs).
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import {
  getCronJobs,
  getTriggerJobs,
} from '../../infrastructure/merge-with-defaults';
import { executeTerraform } from '../terraform';
import {
  buildAwsTerraformEnv,
  checkTerraformInstalled,
  isCronJob,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { buildAwsScheduleTarget } from './build-aws-schedule-target';
import { awsDeployCronJobs } from './deploy-cron-jobs';
import type { AWSCommandContext } from './types';

export interface DeploySchedulerOptions {
  job?: string;
  autoApprove?: boolean;
}

/**
 * Deploy a single scheduled job to EventBridge Scheduler
 */
export async function awsDeployScheduler(
  ctx: AWSCommandContext,
  options: DeploySchedulerOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv, loadFrameworkConfig } = getContext();

  const runtime = buildRuntime();
  checkTerraformInstalled(runtime);

  const { projectRoot, targetEnv, credentials } = ctx;

  // Load infrastructure config and get scheduled jobs, both kinds
  const infraConfig = loadInfrastructureConfig();
  const scheduledJobs = [
    ...getTriggerJobs(infraConfig, targetEnv),
    ...getCronJobs(infraConfig, targetEnv),
  ];

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
        type: 'select',
        name: 'selectedJob',
        message: 'Select scheduled job to deploy:',
        choices: scheduledJobs.map((j) => ({
          name: isCronJob(j)
            ? `${j.name} (${j.schedule}) → ${j.targetService} (cron job)`
            : `${j.name} (${j.schedule}) → ${j.targetService}${j.endpoint}`,
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

  // The schedule's file comes from infra:generate
  const tfFile = isCronJob(jobConfig) ? 'cron-jobs.tf' : 'eventbridge.tf';
  if (!fs.existsSync(path.join(terraformDir, tfFile))) {
    throw new CliError(
      `${tfFile} not found`,
      'infra:deploy-scheduler',
      `Run npx tsdevstack infra:generate --env ${targetEnv} first`,
    );
  }

  // Log deployment info
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Job: ${jobConfig.name}`);
  logger.info(`Schedule: ${jobConfig.schedule}`);
  logger.info(
    isCronJob(jobConfig)
      ? `Target: ${jobConfig.targetService} (cron job)`
      : `Target: ${jobConfig.targetService}${jobConfig.endpoint}`,
  );
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
      'infra:deploy-scheduler',
      initResult.error || 'Check the output above for details',
    );
  }

  // Run targeted terraform apply
  logger.newline();
  logger.info(`Deploying ${jobConfig.name}...`);
  logger.newline();

  const tfVarsFile = path.join(terraformDir, 'terraform.tfvars');
  const applyResult = await executeTerraform('apply', {
    workDir: terraformDir,
    env: tfEnv,
    autoApprove: options.autoApprove ?? isCIEnv(),
    target: buildAwsScheduleTarget(jobConfig),
    varFile: tfVarsFile,
  });

  if (!applyResult.success) {
    throw new CliError(
      `Failed to deploy scheduled job: ${jobConfig.name}`,
      'infra:deploy-scheduler',
      applyResult.error || 'Check the output above for details',
    );
  }

  // A cron job: a revision with the image the service runs, the schedule
  // pointed at it
  if (isCronJob(jobConfig)) {
    await awsDeployCronJobs(ctx, loadFrameworkConfig(), [jobConfig], {
      commandName: 'infra:deploy-scheduler',
    });
  }

  logger.newline();
  logger.complete(`Scheduled job '${jobConfig.name}' deployed successfully!`);
}
