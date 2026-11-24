/**
 * GCP Run Cron Handler
 *
 * Starts a scheduled job now and waits for the run. A cron job: its Cloud
 * Run Job (`{project}-cron-{name}`) is run once and the execution read until
 * it ends; a failed run's last lines are printed as infra:logs prints them.
 * A trigger: its Cloud Scheduler job is run once; the attempt's
 * result is in the scheduler's status (list-schedulers) and the service's
 * log, so the command returns after the start.
 */

import { CloudSchedulerClient } from '@google-cloud/scheduler';
import { getContext } from '../../../context';
import {
  buildGcpCloudRunName,
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS,
  CRON_JOB_TIMEOUT,
  isCronJob,
  runCloudRunJobAndWait,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { resolveGcpNamingScheme } from '../naming/resolve-gcp-naming-scheme';
import { buildGcpCronJobName } from '../build-gcp-cron-job-name';
import { GcpLogsReader } from '../logs/gcp-logs-reader';
import { printFailedRunLines } from '../../logs/print-failed-run-lines';
import type { GCPCommandContext } from './types';

export interface GcpRunCronOptions {
  /** The entry's name in infrastructure.json */
  job: string;
  /** False: leave a failed run's log lines out (default: print them) */
  lines?: boolean;
}

/** gRPC NOT_FOUND */
const NOT_FOUND = 5;

export async function gcpRunCron(
  ctx: GCPCommandContext,
  options: GcpRunCronOptions,
): Promise<void> {
  const { logger, CliError, buildGCPClientOptions } = getContext();
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

  const naming = await resolveGcpNamingScheme(ctx, 'infra:run-cron');
  const logsHint = `Log: npx tsdevstack infra:logs ${job.name} --env ${targetEnv}`;

  if (isCronJob(job)) {
    const jobName = buildGcpCronJobName(projectName, job.name, naming);
    const timeoutSeconds =
      (job.timeout ?? CRON_JOB_TIMEOUT.gcp.default) +
      CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS;
    logger.info(
      `Starting cron job "${job.name}" (Cloud Run Job ${jobName}) in ${targetEnv}...`,
    );

    const startedAt = new Date();
    let result;
    try {
      result = await runCloudRunJobAndWait(buildRuntime(), {
        projectId: credentials.project_id,
        region: credentials.region,
        jobName,
        credentials,
        timeoutSeconds,
        // A failed run's lines are printed below, in the format of infra:logs
        readLogs: false,
      });
    } catch (error) {
      // A refused start is an InfraCoreError: the API's error is its cause
      // (the gRPC code) and the API's message its hint
      const cause = error instanceof Error ? error.cause : undefined;
      const code = (cause as { code?: unknown } | undefined)?.code;
      if (code === NOT_FOUND) {
        throw new CliError(
          `"${job.name}" is not deployed in ${targetEnv} (no Cloud Run Job ${jobName})`,
          'infra:run-cron',
          `Deploy it first: npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      const reason = (error as { hint?: unknown } | null)?.hint;
      throw new CliError(
        `Could not run "${job.name}": ${message}${typeof reason === 'string' ? ` (${reason})` : ''}`,
        'infra:run-cron',
        logsHint,
      );
    }

    logger.newline();
    if (result.success) {
      logger.success(`"${job.name}" finished: Succeeded`);
    } else {
      logger.error(
        `"${job.name}" failed${result.reason ? `: ${result.reason}` : ''}`,
      );
      if (options.lines !== false) {
        await printFailedRunLines({
          createReader: () =>
            new GcpLogsReader({ projectName, targetEnv, credentials, naming }),
          source: { name: job.name, type: 'cron', service: job.targetService },
          startedAt,
        });
      }
      process.exitCode = 1;
    }
    logger.info(logsHint);
    logger.newline();
    return;
  }

  // A trigger: run its Cloud Scheduler job once
  const schedulerName = `projects/${credentials.project_id}/locations/${credentials.region}/jobs/${buildGcpCloudRunName(projectName, job.name, naming)}`;
  logger.info(
    `Starting trigger "${job.name}" (Cloud Scheduler job ${schedulerName.split('/').pop()}) in ${targetEnv}...`,
  );
  const client = new CloudSchedulerClient(buildGCPClientOptions(credentials));
  try {
    await client.runJob({ name: schedulerName });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === NOT_FOUND) {
      throw new CliError(
        `"${job.name}" is not deployed in ${targetEnv} (no Cloud Scheduler job)`,
        'infra:run-cron',
        `Deploy it first: npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`,
      );
    }
    throw new CliError(
      `Could not run "${job.name}": ${error instanceof Error ? error.message : String(error)}`,
      'infra:run-cron',
      logsHint,
    );
  }
  logger.newline();
  logger.success(
    `"${job.name}" started: Cloud Scheduler is calling ${job.targetService}${job.endpoint}`,
  );
  logger.info(
    `The attempt's result: npx tsdevstack infra:list-schedulers --env ${targetEnv}`,
  );
  logger.info(logsHint);
  logger.newline();
}
