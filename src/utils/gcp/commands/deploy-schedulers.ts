/**
 * GCP Deploy Schedulers Handler
 *
 * Deploys all scheduled jobs to Cloud Scheduler.
 * Runs terraform apply on the cloud-scheduler.tf resources.
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../../../context';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import {
  buildGcpTerraformEnv,
  checkTerraformInstalled,
  gcp,
  setSchedulerInvokerBindings,
} from '@tsdevstack/infra-core';
import { executeTerraform } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { toTerraformId } from '../../terraform';
import type { GCPCommandContext } from './types';

export interface DeploySchedulersOptions {
  autoApprove?: boolean;
}

/**
 * Deploy all scheduled jobs to Cloud Scheduler
 */
export async function gcpDeploySchedulers(
  ctx: GCPCommandContext,
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

  // Generate cloud-scheduler.tf (self-contained — no need for infra:generate first)
  const schedulerTfPath = path.join(terraformDir, 'cloud-scheduler.tf');
  const { writeTextFile } = getContext();
  writeTextFile(schedulerTfPath, gcp.generateCloudSchedulerTf(scheduledJobs));

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
  const tfEnv = buildGcpTerraformEnv(runtime, credentials);

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

  // Set IAM bindings for scheduler SA on target services (via SDK, not Terraform)
  const targetServices = Array.from(
    new Set(scheduledJobs.map((j) => j.targetService)),
  );
  logger.info('Setting IAM bindings for scheduler...');
  await setSchedulerInvokerBindings(runtime, {
    projectId: credentials.project_id,
    projectName: ctx.projectName,
    region: credentials.region,
    targetServices,
    credentials,
  });
  logger.newline();

  // Deploy each job with targeted apply
  logger.info('Deploying scheduled jobs...');
  logger.newline();

  const tfVarsFile = path.join(terraformDir, 'terraform.tfvars');

  for (const job of scheduledJobs) {
    logger.info(`  Deploying ${job.name}...`);

    const terraformJobId = toTerraformId(job.name);
    const applyResult = await executeTerraform('apply', {
      workDir: terraformDir,
      env: tfEnv,
      autoApprove: options.autoApprove ?? isCIEnv(),
      target: `google_cloud_scheduler_job.${terraformJobId}`,
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
