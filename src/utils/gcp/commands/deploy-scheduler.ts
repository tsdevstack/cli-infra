/**
 * GCP Deploy Scheduler Handler
 *
 * Deploys a single scheduled job to Cloud Scheduler using targeted Terraform
 * apply; the apply creates the scheduler account when it doesn't exist yet.
 * After it, the account gets run.invoker on what the schedule calls: a
 * trigger's service (SDK, as deploy-schedulers does), or, for a cron job,
 * its Cloud Run Job, created or updated after the schedule (SDK, the image
 * its service runs) with the grant (gcpDeployCronJobs).
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
import {
  buildGcpCloudRunName,
  buildGcpTerraformEnv,
  checkTerraformInstalled,
  gcp,
  isCronJob,
  setSchedulerInvokerBindings,
} from '@tsdevstack/infra-core';
import { gcpDeployCronJobs } from './deploy-cron-jobs';
import { executeTerraform } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { toTerraformId } from '../../terraform';
import type { GCPCommandContext } from './types';
import { resolveGcpNamingScheme } from '../naming/resolve-gcp-naming-scheme';

export interface DeploySchedulerOptions {
  job?: string;
  autoApprove?: boolean;
}

/**
 * Deploy a single scheduled job to Cloud Scheduler
 */
export async function gcpDeployScheduler(
  ctx: GCPCommandContext,
  options: DeploySchedulerOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv, loadFrameworkConfig } = getContext();
  const runtime = buildRuntime();

  checkTerraformInstalled(runtime);

  const { projectRoot, targetEnv, credentials } = ctx;

  // Load infrastructure config and get scheduled jobs, both kinds
  const infraConfig = loadInfrastructureConfig();
  const scheduledJobs = getTriggerJobs(infraConfig, targetEnv);
  const cronJobs = getCronJobs(infraConfig, targetEnv);
  const allJobs = [...scheduledJobs, ...cronJobs];

  if (allJobs.length === 0) {
    throw new CliError(
      `No scheduled jobs configured for environment '${targetEnv}'`,
      'infra:deploy-scheduler',
      'Add scheduledJobs to .tsdevstack/infrastructure.json',
    );
  }

  // Determine which job to deploy
  let jobName = options.job;

  if (!jobName) {
    // In CI mode, fail without job name
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
        choices: allJobs.map((j) => ({
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
  const jobConfig = allJobs.find((j) => j.name === jobName);
  if (!jobConfig) {
    throw new CliError(
      `Scheduled job '${jobName}' not found in config`,
      'infra:deploy-scheduler',
      `Available jobs: ${allJobs.map((j) => j.name).join(', ')}`,
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

  // Generate cloud-scheduler.tf (self-contained — no need for infra:generate first)
  const schedulerTfPath = path.join(terraformDir, 'cloud-scheduler.tf');
  const { writeTextFile } = getContext();
  const naming = await resolveGcpNamingScheme(ctx, 'infra:deploy-scheduler');
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
  logger.info(`Job: ${jobConfig.name}`);
  logger.info(`Schedule: ${jobConfig.schedule}`);
  logger.info(
    isCronJob(jobConfig)
      ? `Target: ${jobConfig.targetService} (cron job)`
      : `Target: ${jobConfig.targetService}${jobConfig.endpoint}`,
  );
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
      'infra:deploy-scheduler',
      initResult.error || 'Check the output above for details',
    );
  }

  // Run targeted terraform apply
  logger.newline();
  logger.info(`Deploying ${jobConfig.name}...`);
  logger.newline();

  const terraformJobId = toTerraformId(jobConfig.name);
  const tfVarsFile = path.join(terraformDir, 'terraform.tfvars');
  const applyResult = await executeTerraform('apply', {
    workDir: terraformDir,
    env: tfEnv,
    autoApprove: options.autoApprove ?? isCIEnv(),
    target: `google_cloud_scheduler_job.${terraformJobId}`,
    varFile: tfVarsFile,
  });

  if (!applyResult.success) {
    throw new CliError(
      `Failed to deploy scheduled job: ${jobConfig.name}`,
      'infra:deploy-scheduler',
      applyResult.error || 'Check the output above for details',
    );
  }

  // A cron job: its Cloud Run Job, with the scheduler account's run.invoker.
  // A trigger: the scheduler account calls its service (SDK, not Terraform)
  logger.newline();
  if (isCronJob(jobConfig)) {
    await gcpDeployCronJobs(ctx, loadFrameworkConfig(), [jobConfig], {
      naming,
      commandName: 'infra:deploy-scheduler',
    });
  } else {
    logger.info('Setting IAM binding for scheduler...');
    await setSchedulerInvokerBindings(runtime, {
      projectId: credentials.project_id,
      projectName: ctx.projectName,
      region: credentials.region,
      targetServices: [
        buildGcpCloudRunName(ctx.projectName, jobConfig.targetService, naming),
      ],
      credentials,
    });
  }

  logger.newline();
  logger.complete(`Scheduled job '${jobConfig.name}' deployed successfully!`);
}
