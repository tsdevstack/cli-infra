/**
 * AWS Deploy Schedulers Handler
 *
 * Deploys all scheduled jobs to EventBridge Scheduler: a targeted terraform
 * apply of each schedule, both kinds. A cron job's apply also creates its
 * task definition, log group and the scheduler role; then its task
 * definition gets a revision with the image the service runs and the
 * schedule is pointed at it (awsDeployCronJobs).
 */

import path from 'node:path';
import fs from 'node:fs';
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
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { buildAwsScheduleTarget } from './build-aws-schedule-target';
import { awsDeployCronJobs } from './deploy-cron-jobs';
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
  const { logger, CliError, isCIEnv, loadFrameworkConfig } = getContext();

  const runtime = buildRuntime();
  checkTerraformInstalled(runtime);

  const { projectRoot, targetEnv, credentials } = ctx;

  // Load infrastructure config and get scheduled jobs, both kinds
  const infraConfig = loadInfrastructureConfig();
  const scheduledJobs = getTriggerJobs(infraConfig, targetEnv);
  const cronJobs = getCronJobs(infraConfig, targetEnv);

  if (scheduledJobs.length === 0 && cronJobs.length === 0) {
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

  // The schedules' files come from infra:generate
  const files = [
    ...(scheduledJobs.length > 0 ? ['eventbridge.tf'] : []),
    ...(cronJobs.length > 0 ? ['cron-jobs.tf'] : []),
  ];
  for (const file of files) {
    if (!fs.existsSync(path.join(terraformDir, file))) {
      throw new CliError(
        `${file} not found`,
        'infra:deploy-schedulers',
        `Run npx tsdevstack infra:generate --env ${targetEnv} first`,
      );
    }
  }

  // Log deployment info
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Jobs to deploy: ${scheduledJobs.length + cronJobs.length}`);
  for (const job of scheduledJobs) {
    logger.info(
      `  - ${job.name} (${job.schedule}) → ${job.targetService}${job.endpoint}`,
    );
  }
  for (const job of cronJobs) {
    logger.info(
      `  - ${job.name} (${job.schedule}) → ${job.targetService} (cron job)`,
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

  for (const job of [...scheduledJobs, ...cronJobs]) {
    logger.info(`  Deploying ${job.name}...`);

    const applyResult = await executeTerraform('apply', {
      workDir: terraformDir,
      env: tfEnv,
      autoApprove: options.autoApprove ?? isCIEnv(),
      target: buildAwsScheduleTarget(job),
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

  // Cron jobs: a revision with the image each service runs, the schedule
  // pointed at it
  if (cronJobs.length > 0) {
    await awsDeployCronJobs(ctx, loadFrameworkConfig(), cronJobs, {
      commandName: 'infra:deploy-schedulers',
    });
  }

  logger.newline();
  logger.complete(
    `All ${scheduledJobs.length + cronJobs.length} scheduled jobs deployed successfully!`,
  );
}
