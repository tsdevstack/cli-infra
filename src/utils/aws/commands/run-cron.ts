/**
 * AWS Run Cron Handler
 *
 * Starts a scheduled job now and waits for the run. A cron job: one task
 * as its schedule would start it (the schedule's task definition revision,
 * cluster and network, read with GetSchedule), read until it stops; a
 * failed run's last lines are printed as infra:logs prints them. A trigger: its job
 * invoker Lambda with the event its schedule sends (runAwsTriggerNow).
 */

import { getContext } from '../../../context';
import {
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS,
  CRON_JOB_TIMEOUT,
  isCronJob,
  runEcsTaskAndWait,
} from '@tsdevstack/infra-core';
import { AWS_RUN_CRON_STARTED_BY } from '../../../constants';
import { buildRuntime } from '../../build-runtime';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { buildAwsCronJobNames } from '../build-aws-cron-job-names';
import { getAwsSchedule } from './get-aws-schedule';
import { runAwsTriggerNow } from './run-aws-trigger-now';
import { AwsLogsReader } from '../logs/aws-logs-reader';
import { printFailedRunLines } from '../../logs/print-failed-run-lines';
import type { AWSCommandContext } from './types';

export interface AwsRunCronOptions {
  /** The entry's name in infrastructure.json */
  job: string;
  /** False: leave a failed run's log lines out (default: print them) */
  lines?: boolean;
}

export async function awsRunCron(
  ctx: AWSCommandContext,
  options: AwsRunCronOptions,
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

  if (!isCronJob(job)) {
    await runAwsTriggerNow(ctx, job, { lines: options.lines });
    return;
  }

  const names = buildAwsCronJobNames(projectName, job.targetService, job.name);
  const logsHint = `Log: npx tsdevstack infra:logs ${job.name} --env ${targetEnv}`;

  // What the schedule starts: the revision the last deploy pointed it at
  let schedule;
  try {
    schedule = await getAwsSchedule(credentials, names.scheduleName);
  } catch (error) {
    throw new CliError(
      `Could not read the schedule of "${job.name}": ${error instanceof Error ? error.message : String(error)}`,
      'infra:run-cron',
    );
  }
  if (!schedule) {
    throw new CliError(
      `"${job.name}" is not deployed in ${targetEnv} (no schedule ${names.scheduleName})`,
      'infra:run-cron',
      `Deploy it first: npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`,
    );
  }

  const target = schedule.Target;
  const ecs = target?.EcsParameters;
  if (!target?.Arn || !ecs?.TaskDefinitionArn) {
    throw new CliError(
      `The schedule ${names.scheduleName} starts no ECS task`,
      'infra:run-cron',
      `Deploy it again: npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`,
    );
  }
  const network = ecs.NetworkConfiguration?.awsvpcConfiguration;

  logger.info(
    `Starting cron job "${job.name}" (${ecs.TaskDefinitionArn.split('/').pop()}) in ${targetEnv}...`,
  );
  const startedAt = new Date();
  let result;
  try {
    result = await runEcsTaskAndWait(buildRuntime(), {
      credentials,
      cluster: target.Arn,
      taskDefinitionArn: ecs.TaskDefinitionArn,
      subnets: network?.Subnets ?? [],
      securityGroups: network?.SecurityGroups ?? [],
      assignPublicIp: network?.AssignPublicIp === 'ENABLED',
      containerName: names.containerName,
      timeoutSeconds:
        (job.timeout ?? CRON_JOB_TIMEOUT.aws.default) +
        CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS,
      startedBy: AWS_RUN_CRON_STARTED_BY,
    });
  } catch (error) {
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
      `"${job.name}" failed${result.exitCode !== undefined ? ` (exit code ${result.exitCode})` : ''}${result.reason ? `: ${result.reason}` : ''}`,
    );
    if (options.lines !== false) {
      await printFailedRunLines({
        createReader: () =>
          new AwsLogsReader({ projectName, targetEnv, credentials }),
        source: { name: job.name, type: 'cron', service: job.targetService },
        startedAt,
      });
    }
    process.exitCode = 1;
  }
  logger.info(logsHint);
  logger.newline();
}
