/**
 * Azure List Schedulers Handler
 *
 * Lists the environment's scheduled jobs, both kinds, with their deployment
 * state and last run. Triggers are the Container App Jobs `{project}-{name}`
 * (Terraform), cron jobs the Container App Jobs `{project}-cron-{name}`
 * (SDK). The last run is the job's newest execution: its state and start.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { getContext } from '../../../context';
import { createAzureCredential, isCronJob } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { buildAzureScheduledJobResourceName } from './build-azure-scheduled-job-resource-name';
import { findLatestJobExecution } from './find-latest-job-execution';
import type { AzureCommandContext } from './types';

interface JobStatus {
  name: string;
  kind: 'trigger' | 'cron';
  schedule: string;
  target: string;
  status: 'DEPLOYED' | 'NOT_FOUND';
  cloudState?: string;
  lastRun: string;
}

/**
 * List scheduled jobs and their deployment status
 */
export async function azureListSchedulers(
  ctx: AzureCommandContext,
): Promise<void> {
  const { logger, CliError } = getContext();

  const { targetEnv, projectName, credentials } = ctx;

  // Load infrastructure config and get scheduled jobs, both kinds
  const infraConfig = loadInfrastructureConfig();
  const scheduledJobs = getScheduledJobs(infraConfig, targetEnv);

  if (scheduledJobs.length === 0) {
    logger.warn(`No scheduled jobs configured for environment '${targetEnv}'`);
    logger.info('Add scheduledJobs to .tsdevstack/infrastructure.json');
    return;
  }

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Checking ${scheduledJobs.length} configured jobs...`);
  logger.newline();

  // Fetch deployed Container App Jobs
  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new ContainerAppsAPIClient(
    credential,
    credentials.subscriptionId,
  );

  const resourceGroupName = `${projectName}-${targetEnv}-rg`;
  const deployedJobs = new Map<string, { state: string }>();

  try {
    for await (const job of client.jobs.listByResourceGroup(
      resourceGroupName,
    )) {
      if (job.name) {
        // The schedule's state, as AWS and GCP show theirs (ENABLED): the
        // job's running state (Ready, Suspended). A deploy that did not
        // succeed shows that instead: "Succeeded" read like a run's result.
        const provisioningState = job.provisioningState ?? 'Unknown';
        deployedJobs.set(job.name, {
          state:
            provisioningState === 'Succeeded'
              ? (job.runningState ?? 'Deployed')
              : provisioningState,
        });
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      'Failed to list Container App Jobs',
      'infra:list-schedulers',
      errorMessage,
    );
  }

  // Build status for each configured job, with its last run
  const jobStatuses: JobStatus[] = [];
  for (const job of scheduledJobs) {
    const resourceName = buildAzureScheduledJobResourceName(projectName, job);
    const deployed = deployedJobs.get(resourceName);
    const kind = isCronJob(job) ? 'cron' : 'trigger';
    const target = isCronJob(job)
      ? job.targetService
      : `${job.targetService}${job.endpoint}`;

    if (!deployed) {
      jobStatuses.push({
        name: job.name,
        kind,
        schedule: job.schedule,
        target,
        status: 'NOT_FOUND',
        lastRun: '-',
      });
      continue;
    }

    let lastRun = 'never ran';
    try {
      const latest = await findLatestJobExecution(
        client,
        resourceGroupName,
        resourceName,
      );
      if (latest) {
        lastRun = `${latest.status ?? 'Unknown'}${latest.startTime ? ` ${latest.startTime.toISOString()}` : ''}`;
      }
    } catch {
      lastRun = '? (executions not readable)';
    }

    jobStatuses.push({
      name: job.name,
      kind,
      schedule: job.schedule,
      target,
      status: 'DEPLOYED',
      cloudState: deployed.state,
      lastRun,
    });
  }

  // Print table
  const width = (values: string[], min: number): number =>
    Math.max(...values.map((v) => v.length), min);
  const nameWidth = width(
    jobStatuses.map((j) => j.name),
    8,
  );
  const kindWidth = width(
    jobStatuses.map((j) => j.kind),
    4,
  );
  const scheduleWidth = width(
    jobStatuses.map((j) => j.schedule),
    8,
  );
  const targetWidth = width(
    jobStatuses.map((j) => j.target),
    6,
  );
  const statusWidth = width(
    jobStatuses.map((j) =>
      j.status === 'DEPLOYED'
        ? `✓ ${j.cloudState || 'Deployed'}`
        : '✗ NOT FOUND',
    ),
    6,
  );

  const header = [
    'Job Name'.padEnd(nameWidth),
    'Kind'.padEnd(kindWidth),
    'Schedule'.padEnd(scheduleWidth),
    'Target'.padEnd(targetWidth),
    'Status'.padEnd(statusWidth),
    'Last run',
  ].join(' | ');

  logger.info(header);
  logger.info('-'.repeat(header.length));

  for (const job of jobStatuses) {
    const statusText =
      job.status === 'DEPLOYED'
        ? `✓ ${job.cloudState || 'Deployed'}`
        : '✗ NOT FOUND';
    const row = [
      job.name.padEnd(nameWidth),
      job.kind.padEnd(kindWidth),
      job.schedule.padEnd(scheduleWidth),
      job.target.padEnd(targetWidth),
      statusText.padEnd(statusWidth),
      job.lastRun,
    ].join(' | ');

    if (job.status === 'DEPLOYED') {
      logger.success(row);
    } else {
      logger.warn(row);
    }
  }

  logger.newline();

  // Summary
  const deployedCount = jobStatuses.filter(
    (j) => j.status === 'DEPLOYED',
  ).length;
  const notFoundCount = jobStatuses.length - deployedCount;

  if (notFoundCount > 0) {
    logger.warn(`${notFoundCount} job(s) not deployed. Run:`);
    logger.info(`  npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`);
  } else {
    logger.success(`All ${deployedCount} jobs are deployed.`);
  }
}
