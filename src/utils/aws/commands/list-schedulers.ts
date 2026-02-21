/**
 * AWS List Schedulers Handler
 *
 * Lists scheduled jobs and their deployment status.
 * Cross-references infrastructure config with EventBridge Scheduler API.
 */

import {
  SchedulerClient,
  ListSchedulesCommand,
} from '@aws-sdk/client-scheduler';
import { getContext } from '../../../context';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { buildScheduledJobKey } from './build-scheduled-job-key';
import type { AWSCommandContext } from './types';

interface JobStatus {
  name: string;
  schedule: string;
  targetService: string;
  endpoint: string;
  status: 'DEPLOYED' | 'NOT_FOUND';
  cloudState?: string;
}

/**
 * List scheduled jobs and their deployment status
 */
export async function awsListSchedulers(ctx: AWSCommandContext): Promise<void> {
  const { logger, CliError } = getContext();

  const { targetEnv, projectName, credentials } = ctx;

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

  // Fetch deployed schedules from EventBridge Scheduler
  const clientConfig = buildAWSClientConfig(credentials);
  const scheduler = new SchedulerClient(clientConfig);

  const deployedSchedules = new Map<string, { state: string }>();

  try {
    const prefix = `${projectName}-`;
    let nextToken: string | undefined;

    do {
      const response = await scheduler.send(
        new ListSchedulesCommand({
          NamePrefix: prefix,
          GroupName: 'default',
          NextToken: nextToken,
        }),
      );

      for (const schedule of response.Schedules ?? []) {
        if (schedule.Name) {
          deployedSchedules.set(schedule.Name, {
            state: schedule.State ?? 'UNKNOWN',
          });
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      'Failed to list EventBridge Scheduler schedules',
      'infra:list-schedulers',
      errorMessage,
    );
  }

  // Build status for each configured job
  const jobStatuses: JobStatus[] = scheduledJobs.map((job) => {
    const jobKey = buildScheduledJobKey(job.targetService, job.name);
    const scheduleName = `${projectName}-${jobKey}`;
    const deployed = deployedSchedules.get(scheduleName);

    if (deployed) {
      return {
        name: job.name,
        schedule: job.schedule,
        targetService: job.targetService,
        endpoint: job.endpoint,
        status: 'DEPLOYED' as const,
        cloudState: deployed.state,
      };
    }

    return {
      name: job.name,
      schedule: job.schedule,
      targetService: job.targetService,
      endpoint: job.endpoint,
      status: 'NOT_FOUND' as const,
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
    'Status',
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
      statusText,
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
