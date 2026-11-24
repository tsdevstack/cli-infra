/**
 * AWS List Schedulers Handler
 *
 * Lists the environment's scheduled jobs, both kinds, with their schedule's
 * state in EventBridge Scheduler, and a cron job's last run: the end line of
 * its newest log stream (A6; ECS forgets stopped tasks after about an hour).
 * A trigger's runs are in the job invoker's log (infra:logs).
 */

import {
  SchedulerClient,
  ListSchedulesCommand,
} from '@aws-sdk/client-scheduler';
import { isCronJob } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { AWS_SCHEDULE_GROUP } from '../../../constants';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { buildAwsCronJobNames } from '../build-aws-cron-job-names';
import { buildScheduledJobKey } from './build-scheduled-job-key';
import { readAwsCronJobLastRun } from './read-aws-cron-job-last-run';
import type { AWSCommandContext } from './types';

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
export async function awsListSchedulers(ctx: AWSCommandContext): Promise<void> {
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
          GroupName: AWS_SCHEDULE_GROUP,
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

  // Build status for each configured job (both kinds' schedules are
  // {project}-{service}-{name})
  const jobStatuses: JobStatus[] = [];
  for (const job of scheduledJobs) {
    const cron = isCronJob(job);
    const scheduleName = `${projectName}-${buildScheduledJobKey(job.targetService, job.name)}`;
    const deployed = deployedSchedules.get(scheduleName);
    const base = {
      name: job.name,
      kind: cron ? ('cron' as const) : ('trigger' as const),
      schedule: job.schedule,
      target: cron ? job.targetService : `${job.targetService}${job.endpoint}`,
    };

    if (!deployed) {
      jobStatuses.push({ ...base, status: 'NOT_FOUND', lastRun: '-' });
      continue;
    }

    let lastRun = '-';
    if (cron) {
      try {
        lastRun = await readAwsCronJobLastRun(
          credentials,
          buildAwsCronJobNames(projectName, job.targetService, job.name)
            .logGroupName,
        );
      } catch {
        lastRun = '? (log not readable)';
      }
    }
    jobStatuses.push({
      ...base,
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

  const header = [
    'Job Name'.padEnd(nameWidth),
    'Kind'.padEnd(kindWidth),
    'Schedule'.padEnd(scheduleWidth),
    'Target'.padEnd(targetWidth),
    'Status'.padEnd(10),
    'Last run',
  ].join(' | ');

  logger.info(header);
  logger.info('-'.repeat(header.length));

  for (const job of jobStatuses) {
    const statusText =
      job.status === 'DEPLOYED'
        ? `✓ ${job.cloudState || 'ENABLED'}`
        : '✗ NOT FOUND';
    const row = [
      job.name.padEnd(nameWidth),
      job.kind.padEnd(kindWidth),
      job.schedule.padEnd(scheduleWidth),
      job.target.padEnd(targetWidth),
      statusText.padEnd(10),
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
