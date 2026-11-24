/**
 * GCP List Schedulers Handler
 *
 * Lists the environment's scheduled jobs, both kinds, with their schedule's
 * state in Cloud Scheduler and their last run: a trigger's last attempt, a
 * cron job's newest Cloud Run Job execution (A6).
 */

import { CloudSchedulerClient } from '@google-cloud/scheduler';
import { ExecutionsClient } from '@google-cloud/run';
import { getContext } from '../../../context';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import type { GCPCommandContext } from './types';
import { buildGcpCloudRunName, isCronJob } from '@tsdevstack/infra-core';
import { resolveGcpNamingScheme } from '../naming/resolve-gcp-naming-scheme';
import { buildGcpCronJobName } from '../build-gcp-cron-job-name';

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
export async function gcpListSchedulers(ctx: GCPCommandContext): Promise<void> {
  const { logger, CliError, buildGCPClientOptions } = getContext();

  const { targetEnv, credentials } = ctx;

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

  const clientOptions = buildGCPClientOptions(credentials);
  const schedulerClient = new CloudSchedulerClient(clientOptions);
  const parent = `projects/${credentials.project_id}/locations/${credentials.region}`;

  // Get deployed jobs from Cloud Scheduler
  const deployedJobs = new Map<
    string,
    { state: string; lastAttemptTime?: string }
  >();

  try {
    const [jobs] = await schedulerClient.listJobs({ parent });

    for (const job of jobs) {
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

  // Build status for each configured job (by its Cloud Scheduler name)
  const naming = await resolveGcpNamingScheme(ctx, 'infra:list-schedulers');
  const executionsClient = new ExecutionsClient(clientOptions);
  const jobStatuses: JobStatus[] = [];
  for (const job of scheduledJobs) {
    const deployed = deployedJobs.get(
      buildGcpCloudRunName(ctx.projectName, job.name, naming),
    );
    const cron = isCronJob(job);
    const target = cron
      ? job.targetService
      : `${job.targetService}${job.endpoint}`;

    if (!deployed) {
      jobStatuses.push({
        name: job.name,
        kind: cron ? 'cron' : 'trigger',
        schedule: job.schedule,
        target,
        status: 'NOT_FOUND',
        lastRun: '-',
      });
      continue;
    }

    let lastRun = deployed.lastAttemptTime ?? 'never ran';
    if (cron) {
      // The newest execution of the Cloud Run Job: its state and start
      const cloudRunJob = `${parent}/jobs/${buildGcpCronJobName(ctx.projectName, job.name, naming)}`;
      try {
        const [executions] = await executionsClient.listExecutions({
          parent: cloudRunJob,
        });
        const latest = [...executions].sort(
          (a, b) =>
            Number(b.createTime?.seconds ?? 0) -
            Number(a.createTime?.seconds ?? 0),
        )[0];
        if (!latest) {
          lastRun = 'never ran';
        } else {
          const state = !latest.completionTime
            ? 'Running'
            : latest.succeededCount === 1
              ? 'Succeeded'
              : latest.failedCount === 1
                ? 'Failed'
                : 'Ended';
          const started = latest.createTime?.seconds
            ? new Date(Number(latest.createTime.seconds) * 1000).toISOString()
            : '';
          lastRun = `${state}${started ? ` ${started}` : ''}`;
        }
      } catch {
        lastRun = '? (executions not readable)';
      }
    }

    jobStatuses.push({
      name: job.name,
      kind: cron ? 'cron' : 'trigger',
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
