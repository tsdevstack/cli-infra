/**
 * GCP List Schedulers Handler
 *
 * Lists scheduled jobs and their deployment status.
 * Cross-references infrastructure config with Cloud Scheduler API.
 */

import { CloudSchedulerClient } from '@google-cloud/scheduler';
import { getContext } from '../../../context';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import type { GCPCommandContext } from './types';

interface JobStatus {
  name: string;
  schedule: string;
  targetService: string;
  endpoint: string;
  status: 'DEPLOYED' | 'NOT_FOUND' | 'ERROR';
  cloudState?: string;
  lastRunTime?: string;
}

/**
 * List scheduled jobs and their deployment status
 */
export async function gcpListSchedulers(ctx: GCPCommandContext): Promise<void> {
  const { logger, CliError, buildGCPClientOptions } = getContext();

  const { targetEnv, credentials } = ctx;

  // Load infrastructure config and get scheduled jobs
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

  // Initialize Cloud Scheduler client
  const schedulerClient = new CloudSchedulerClient(
    buildGCPClientOptions(credentials),
  );

  // Get deployed jobs from Cloud Scheduler
  const deployedJobs = new Map<
    string,
    { state: string; lastAttemptTime?: string }
  >();

  try {
    const parent = `projects/${credentials.project_id}/locations/${credentials.region}`;
    const [jobs] = await schedulerClient.listJobs({ parent });

    for (const job of jobs) {
      // Extract job name from full path (projects/xxx/locations/xxx/jobs/job-name)
      const jobName = job.name?.split('/').pop();
      if (jobName) {
        deployedJobs.set(jobName, {
          state: String(job.state ?? 'UNKNOWN'),
          lastAttemptTime: job.lastAttemptTime?.seconds
            ? new Date(Number(job.lastAttemptTime.seconds) * 1000).toISOString()
            : undefined,
        });
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      'Failed to list Cloud Scheduler jobs',
      'infra:list-schedulers',
      errorMessage,
    );
  }

  // Build status for each configured job
  const jobStatuses: JobStatus[] = scheduledJobs.map((job) => {
    const deployed = deployedJobs.get(job.name);

    if (deployed) {
      return {
        name: job.name,
        schedule: job.schedule,
        targetService: job.targetService,
        endpoint: job.endpoint,
        status: 'DEPLOYED',
        cloudState: deployed.state,
        lastRunTime: deployed.lastAttemptTime,
      };
    }

    return {
      name: job.name,
      schedule: job.schedule,
      targetService: job.targetService,
      endpoint: job.endpoint,
      status: 'NOT_FOUND',
    };
  });

  // Print table
  const maxNameLen = Math.max(...jobStatuses.map((j) => j.name.length), 8);
  const maxScheduleLen = Math.max(
    ...jobStatuses.map((j) => j.schedule.length),
    8,
  );
  const maxTargetLen = Math.max(
    ...jobStatuses.map((j) => `${j.targetService}${j.endpoint}`.length),
    6,
  );

  // Header
  const header = [
    'Job Name'.padEnd(maxNameLen),
    'Schedule'.padEnd(maxScheduleLen),
    'Target'.padEnd(maxTargetLen),
    'Status'.padEnd(10),
    'Last Run',
  ].join(' | ');

  const separator = '-'.repeat(header.length);

  logger.info(header);
  logger.info(separator);

  // Rows
  for (const job of jobStatuses) {
    const target = `${job.targetService}${job.endpoint}`;
    const statusIcon = job.status === 'DEPLOYED' ? '✓' : '✗';
    const statusText =
      job.status === 'DEPLOYED'
        ? `${statusIcon} ${job.cloudState || 'ENABLED'}`
        : `${statusIcon} NOT FOUND`;

    const row = [
      job.name.padEnd(maxNameLen),
      job.schedule.padEnd(maxScheduleLen),
      target.padEnd(maxTargetLen),
      statusText.padEnd(10),
      job.lastRunTime || '-',
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
  const notFoundCount = jobStatuses.filter(
    (j) => j.status === 'NOT_FOUND',
  ).length;

  if (notFoundCount > 0) {
    logger.warn(`${notFoundCount} job(s) not deployed. Run:`);
    logger.info(`  npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`);
  } else {
    logger.success(`All ${deployedCount} jobs are deployed.`);
  }
}
