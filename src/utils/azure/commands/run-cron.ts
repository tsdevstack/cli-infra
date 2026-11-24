/**
 * Azure Run Cron Handler
 *
 * Starts a scheduled job now and waits for the run: a cron job's Container
 * App Job (`{project}-cron-{name}`) or a trigger's (`{project}-{name}`, the
 * curl job). Azure's start answers once the execution exists; the run's
 * result is the execution's own state, read until it ends. A failed run's
 * lines are not printed here as on the other providers: they reach Log
 * Analytics 1 to 10 minutes after the run, so the command says when to
 * read them.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { getContext } from '../../../context';
import {
  createAzureCredential,
  CRON_JOB_TIMEOUT,
  isCronJob,
  SCHEDULED_JOB_HTTP_TIMEOUT,
} from '@tsdevstack/infra-core';
import {
  AZURE_JOB_START_MARGIN_SECONDS,
  AZURE_RESOURCE_GROUP_SUFFIX,
} from '../../../constants';
import { buildRuntime } from '../../build-runtime';
import { buildAzureCronJobPlatformTimeout } from '../build-azure-cron-job-platform-timeout';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { buildAzureScheduledJobResourceName } from './build-azure-scheduled-job-resource-name';
import { waitForJobExecution } from './wait-for-job-execution';
import type { AzureCommandContext } from './types';

export interface AzureRunCronOptions {
  /** The entry's name in infrastructure.json */
  job: string;
}

export async function azureRunCron(
  ctx: AzureCommandContext,
  options: AzureRunCronOptions,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { projectName, targetEnv, credentials } = ctx;

  const jobs = getScheduledJobs(loadInfrastructureConfig(), targetEnv);
  const job = jobs.find((entry) => entry.name === options.job);
  if (!job) {
    throw new CliError(
      `Scheduled job "${options.job}" is not in ${targetEnv}`,
      'infra:run-cron',
      jobs.length > 0
        ? `Jobs in ${targetEnv}.scheduledJobs: ${jobs.map((j) => j.name).join(', ')}`
        : `${targetEnv} has no scheduledJobs in .tsdevstack/infrastructure.json`,
    );
  }

  const cron = isCronJob(job);
  const resourceName = buildAzureScheduledJobResourceName(projectName, job);
  const runSeconds = cron
    ? (job.timeout ?? CRON_JOB_TIMEOUT.azure.default)
    : (job.httpTimeout ?? SCHEDULED_JOB_HTTP_TIMEOUT.azure.default);
  // Azure's limit on the run (replicaTimeout), plus the time a run may take
  // to start
  const waitSeconds =
    (cron ? buildAzureCronJobPlatformTimeout(runSeconds) : runSeconds) +
    AZURE_JOB_START_MARGIN_SECONDS;
  const resourceGroupName = `${projectName}-${targetEnv}${AZURE_RESOURCE_GROUP_SUFFIX}`;

  logger.info(
    `Starting ${cron ? 'cron job' : 'trigger'} "${job.name}" (${resourceName}) in ${targetEnv}...`,
  );

  const client = new ContainerAppsAPIClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );

  let executionName: string | undefined;
  try {
    const poller = client.jobs.start(resourceGroupName, resourceName, {});
    executionName = (await poller.pollUntilDone()).name;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      throw new CliError(
        `"${job.name}" is not deployed in ${targetEnv} (no Container App Job ${resourceName})`,
        'infra:run-cron',
        `Deploy it first: npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`,
      );
    }
    throw new CliError(
      `Could not start "${job.name}": ${error instanceof Error ? error.message : String(error)}`,
      'infra:run-cron',
      'Check the job in the Azure portal, or run infra:deploy-schedulers again',
    );
  }
  if (!executionName) {
    throw new CliError(
      `The start of "${job.name}" answered without an execution name`,
      'infra:run-cron',
      `See the job's executions: npx tsdevstack infra:list-schedulers --env ${targetEnv}`,
    );
  }

  logger.info(
    `Execution ${executionName} started, waiting up to ${waitSeconds} s for it to end...`,
  );
  const end = await waitForJobExecution(
    client,
    resourceGroupName,
    resourceName,
    executionName,
    waitSeconds,
  );

  logger.newline();
  if (end.status === 'Succeeded') {
    logger.success(`"${job.name}" finished: Succeeded`);
  } else {
    logger.error(
      `"${job.name}" ended: ${end.status}${end.detail ? ` (${end.detail})` : ''}`,
    );
    logger.info(
      "The run's log lines arrive 1 to 10 minutes after the run on Azure.",
    );
    process.exitCode = 1;
  }
  logger.info(`Log: npx tsdevstack infra:logs ${job.name} --env ${targetEnv}`);
  logger.newline();
}
