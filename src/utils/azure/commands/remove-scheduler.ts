/**
 * Azure Remove Scheduler Handler
 *
 * Removes a scheduled job (Container App Job) from Azure.
 * Discovery-based: queries Azure for deployed jobs; a cron job whose entry
 * is gone from infrastructure.json is found by its tag.
 */

import inquirer from 'inquirer';
import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { deleteContainerAppJob } from '../delete';
import { resolveAzureScheduledJobResourceName } from './resolve-azure-scheduled-job-resource-name';
import type { AzureCommandContext } from './types';
import { buildAzureScheduledJobResourceName } from './build-azure-scheduled-job-resource-name';
import { remindToRemoveScheduledJobEntry } from '../../infrastructure/remind-to-remove-scheduled-job-entry';

export interface RemoveSchedulerOptions {
  job?: string;
  confirm?: boolean;
}

interface DeployedJob {
  name: string;
  state: string;
}

/**
 * Remove a scheduled job from Azure Container App Jobs
 */
export async function azureRemoveScheduler(
  ctx: AzureCommandContext,
  options: RemoveSchedulerOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  const { targetEnv, credentials, projectName } = ctx;
  const resourceGroupName = `${projectName}-${targetEnv}-rg`;

  // Resolve the Container App Job: --job is the entry's name (a trigger's
  // {project}-{name}, a cron job's {project}-cron-{name}), a cron job's name
  // found by its tag when the entry is gone, or a resource name
  let jobName: string;
  if (options.job) {
    try {
      jobName = await resolveAzureScheduledJobResourceName(
        projectName,
        targetEnv,
        options.job,
        credentials,
      );
    } catch (error) {
      throw new CliError(
        "Could not list the environment's Container App Jobs",
        'infra:remove-scheduler',
        `${error instanceof Error ? error.message : String(error)}. Nothing was deleted; run the command again.`,
      );
    }
  } else {
    jobName = await selectJobInteractive(ctx);
  }

  logger.info(`Job: ${jobName}`);
  logger.info(`Environment: ${targetEnv}`);
  logger.newline();

  // Confirmation (interactive only — CI confirm is handled by dispatcher)
  if (!ctx.runningInCI) {
    logger.warn(
      'This will PERMANENTLY DELETE the Container App Job from Azure.',
    );
    logger.newline();

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Delete job "${jobName}" from ${targetEnv}?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      logger.info('Aborted.');
      return;
    }
  }

  // Delete Container App Job
  logger.info('Deleting Container App Job...');

  const result = await deleteContainerAppJob({
    credentials,
    resourceGroupName,
    jobName,
  });

  if (!result.success) {
    throw new CliError(
      `Failed to delete job: ${result.error}`,
      'infra:remove-scheduler',
      'Check if the job exists and you have permissions',
    );
  }

  if (result.deleted) {
    logger.success(`Deleted job: ${jobName}`);
  } else {
    logger.info(`Job not found (already deleted): ${jobName}`);
  }

  logger.newline();
  logger.success(`Job "${jobName}" removed from ${targetEnv}`);
  logger.newline();

  // Only while the entry is still there: the next deploy would bring it back
  remindToRemoveScheduledJobEntry(
    targetEnv,
    (entry) =>
      entry.name === options.job ||
      buildAzureScheduledJobResourceName(projectName, entry) === jobName,
  );
}

/**
 * Discover deployed Container App Jobs
 */
async function discoverDeployedJobs(
  ctx: AzureCommandContext,
): Promise<DeployedJob[]> {
  const { CliError } = getContext();
  const { projectName, targetEnv, credentials } = ctx;

  const resourceGroupName = `${projectName}-${targetEnv}-rg`;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new ContainerAppsAPIClient(
    credential,
    credentials.subscriptionId,
  );

  const jobs: DeployedJob[] = [];

  try {
    for await (const job of client.jobs.listByResourceGroup(
      resourceGroupName,
    )) {
      if (job.name) {
        jobs.push({
          name: job.name,
          state: job.provisioningState ?? 'Unknown',
        });
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      'Failed to list Container App Jobs',
      'infra:remove-scheduler',
      errorMessage,
    );
  }

  return jobs;
}

/**
 * Interactively select a job from deployed Container App Jobs
 */
async function selectJobInteractive(ctx: AzureCommandContext): Promise<string> {
  const { logger, CliError } = getContext();

  logger.info('Discovering deployed jobs...');
  logger.newline();

  const deployedJobs = await discoverDeployedJobs(ctx);

  if (deployedJobs.length === 0) {
    throw new CliError(
      'No deployed jobs found',
      'infra:remove-scheduler',
      'No Container App Jobs found in this environment',
    );
  }

  // Build choices with job details
  const choices = deployedJobs.map((job) => ({
    name: `${job.name} - ${job.state}`,
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
      message: 'Select job to remove:',
      choices,
    },
  ]);

  // If manual entry selected, prompt for name
  if (selectedJob === '__manual__') {
    const { enteredName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'enteredName',
        message: 'Enter job name to remove:',
        validate: (input: string) => {
          if (!input || !input.trim()) {
            return 'Job name is required';
          }
          return true;
        },
      },
    ]);
    return enteredName.trim();
  }

  return selectedJob;
}
