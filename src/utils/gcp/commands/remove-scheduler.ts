/**
 * GCP Remove Scheduler Handler
 *
 * Removes a scheduled job from Cloud Scheduler.
 * Discovery-based: queries GCP for deployed jobs.
 */

import inquirer from 'inquirer';
import { CloudSchedulerClient } from '@google-cloud/scheduler';
import { getContext } from '../../../context';
import { deleteSchedulerJob } from '../delete';
import type { GCPCommandContext } from './types';

export interface RemoveSchedulerOptions {
  job?: string;
  confirm?: boolean;
}

interface DeployedJob {
  name: string;
  schedule: string;
  state: string;
  targetUri?: string;
}

/**
 * Remove a scheduled job from Cloud Scheduler
 */
export async function gcpRemoveScheduler(
  ctx: GCPCommandContext,
  options: RemoveSchedulerOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  const { targetEnv, credentials } = ctx;

  // Resolve job name
  let jobName: string;
  if (options.job) {
    jobName = options.job;
  } else {
    jobName = await selectJobInteractive(ctx);
  }

  logger.info(`Job: ${jobName}`);
  logger.info(`Environment: ${targetEnv}`);
  logger.newline();

  // Confirmation (interactive only — CI confirm is handled by dispatcher)
  if (!ctx.runningInCI) {
    logger.warn(
      'This will PERMANENTLY DELETE the scheduled job from Cloud Scheduler.',
    );
    logger.newline();

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Delete scheduled job "${jobName}" from ${targetEnv}?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      logger.info('Aborted.');
      return;
    }
  }

  // Delete Cloud Scheduler job
  logger.info('Deleting Cloud Scheduler job...');

  const result = await deleteSchedulerJob({
    jobName,
    projectId: credentials.project_id,
    region: credentials.region,
    credentials,
  });

  if (!result.success) {
    throw new CliError(
      `Failed to delete scheduler job: ${result.error}`,
      'infra:remove-scheduler',
      'Check if the job exists and you have permissions',
    );
  }

  if (result.deleted) {
    logger.success(`Deleted scheduled job: ${jobName}`);
  } else {
    logger.info(`Job not found (already deleted): ${jobName}`);
  }

  logger.newline();
  logger.success(`Scheduled job "${jobName}" removed from ${targetEnv}`);
  logger.newline();

  // Warning about infrastructure.json cleanup
  logger.warn(
    'Remember to remove this job from .tsdevstack/infrastructure.json',
  );
  logger.info(
    'The framework does not auto-modify user-managed configuration files.',
  );
  logger.newline();
}

/**
 * Discover deployed jobs from Cloud Scheduler
 */
async function discoverDeployedJobs(
  credentials: GCPCommandContext['credentials'],
): Promise<DeployedJob[]> {
  const { CliError, buildGCPClientOptions } = getContext();

  const client = new CloudSchedulerClient(buildGCPClientOptions(credentials));
  const parent = `projects/${credentials.project_id}/locations/${credentials.region}`;

  try {
    const [jobs] = await client.listJobs({ parent });

    return jobs.map((job) => {
      // Extract job name from full path
      const name = job.name?.split('/').pop() || 'unknown';
      const schedule = job.schedule || 'unknown';
      const state = String(job.state ?? 'UNKNOWN');

      // Extract target URI from httpTarget (convert null to undefined)
      const targetUri = job.httpTarget?.uri ?? undefined;

      return {
        name,
        schedule,
        state,
        targetUri,
      };
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      'Failed to list Cloud Scheduler jobs',
      'infra:remove-scheduler',
      errorMessage,
    );
  }
}

/**
 * Interactively select a job from deployed jobs in Cloud Scheduler
 */
async function selectJobInteractive(ctx: GCPCommandContext): Promise<string> {
  const { logger, CliError } = getContext();

  logger.info('Discovering deployed scheduled jobs...');
  logger.newline();

  // Query Cloud Scheduler for deployed jobs
  const deployedJobs = await discoverDeployedJobs(ctx.credentials);

  if (deployedJobs.length === 0) {
    throw new CliError(
      'No deployed scheduled jobs found',
      'infra:remove-scheduler',
      'No Cloud Scheduler jobs found in this environment',
    );
  }

  // Build choices with job details
  const choices = deployedJobs.map((job) => ({
    name: `${job.name} (${job.schedule}) - ${job.state}`,
    value: job.name,
  }));

  // Add manual entry option
  choices.push({
    name: '[ Enter job name manually ]',
    value: '__manual__',
  });

  const { selectedJob } = await inquirer.prompt([
    {
      type: 'select',
      name: 'selectedJob',
      message: 'Select scheduled job to remove:',
      choices,
    },
  ]);

  // If manual entry selected, prompt for name
  if (selectedJob === '__manual__') {
    const { enteredJobName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'enteredJobName',
        message: 'Enter job name to remove:',
        validate: (input: string) => {
          if (!input || !input.trim()) {
            return 'Job name is required';
          }
          return true;
        },
      },
    ]);
    return enteredJobName.trim();
  }

  return selectedJob;
}
