/**
 * GCP Deploy Schedulers Handler
 *
 * Deploys all scheduled jobs to Cloud Scheduler: both kinds' schedules with
 * terraform apply on the cloud-scheduler.tf resources. The schedules come
 * first: their apply creates the scheduler account the rest needs. Then the
 * scheduler account gets run.invoker on the services the triggers call, and
 * the cron jobs' Cloud Run Jobs are created or updated (SDK, the image each
 * service runs), each with the account's run.invoker (gcpDeployCronJobs).
 * As in infra:deploy, a new cron job's schedule exists a moment before its
 * job does.
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../../../context';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import {
  getCronJobs,
  getTriggerJobs,
} from '../../infrastructure/merge-with-defaults';
import { gcpDeployCronJobs } from './deploy-cron-jobs';
import {
  buildGcpCloudRunName,
  buildGcpTerraformEnv,
  checkTerraformInstalled,
  gcp,
  setSchedulerInvokerBindings,
} from '@tsdevstack/infra-core';
import { executeTerraform } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { toTerraformId } from '../../terraform';
import type { GCPCommandContext } from './types';
import { resolveGcpNamingScheme } from '../naming/resolve-gcp-naming-scheme';

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

  // Generate cloud-scheduler.tf (self-contained — no need for infra:generate first)
  const schedulerTfPath = path.join(terraformDir, 'cloud-scheduler.tf');
  const { writeTextFile } = getContext();
  const naming = await resolveGcpNamingScheme(ctx, 'infra:deploy-schedulers');
  writeTextFile(
    schedulerTfPath,
    gcp.generateCloudSchedulerTf(
      scheduledJobs,
      {
        projectName: ctx.projectName,
        naming,
      },
      cronJobs,
    ),
  );

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

  // Deploy each job with targeted apply. The first one also creates the
  // scheduler account (a dependency of every schedule)
  logger.info('Deploying scheduled jobs...');
  logger.newline();

  const tfVarsFile = path.join(terraformDir, 'terraform.tfvars');

  for (const job of [...scheduledJobs, ...cronJobs]) {
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

  // The scheduler account calls the triggers' services (SDK, not Terraform)
  if (scheduledJobs.length > 0) {
    const targetServices = Array.from(
      new Set(scheduledJobs.map((j) => j.targetService)),
    ).map((name) => buildGcpCloudRunName(ctx.projectName, name, naming));
    logger.info('Setting IAM bindings for scheduler...');
    await setSchedulerInvokerBindings(runtime, {
      projectId: credentials.project_id,
      projectName: ctx.projectName,
      region: credentials.region,
      targetServices,
      credentials,
    });
    logger.newline();
  }

  // Cron jobs: their Cloud Run Jobs, each with the account's run.invoker
  if (cronJobs.length > 0) {
    await gcpDeployCronJobs(ctx, loadFrameworkConfig(), cronJobs, {
      naming,
      commandName: 'infra:deploy-schedulers',
    });
    logger.newline();
  }

  logger.complete(
    `All ${scheduledJobs.length + cronJobs.length} scheduled jobs deployed successfully!`,
  );
}
