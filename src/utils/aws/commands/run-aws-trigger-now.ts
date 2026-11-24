/**
 * Start a trigger now on AWS and wait for its run
 *
 * Invokes the job invoker Lambda with the event the trigger's schedule
 * sends (its target input, read with GetSchedule, not rebuilt), and waits
 * for the answer: the function calls the service's endpoint and answers
 * `{ statusCode, body }`, or throws when the call fails (the error and the
 * end of its log come back with the answer). A failed run sets exit code 1.
 * With `lines` false the end of the log is left out (the MCP tool: log lines
 * are read with get_logs, which asks the user first).
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { TriggerJobConfig } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { buildScheduledJobKey } from './build-scheduled-job-key';
import { getAwsSchedule } from './get-aws-schedule';
import type { AWSCommandContext } from './types';

/** How much of the endpoint's answer is shown, as the invoker logs it */
const RESPONSE_SHOWN_CHARS = 1000;

export async function runAwsTriggerNow(
  ctx: AWSCommandContext,
  job: TriggerJobConfig,
  options: { lines?: boolean } = {},
): Promise<void> {
  const { logger, CliError } = getContext();
  const { projectName, targetEnv, credentials } = ctx;
  const scheduleName = `${projectName}-${buildScheduledJobKey(job.targetService, job.name)}`;
  const logsHint = `Log: npx tsdevstack infra:logs ${job.name} --env ${targetEnv}`;
  const deployHint = `Deploy it first: npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`;

  // The event the schedule sends, as it sends it
  let schedule;
  try {
    schedule = await getAwsSchedule(credentials, scheduleName);
  } catch (error) {
    throw new CliError(
      `Could not read the schedule of "${job.name}": ${error instanceof Error ? error.message : String(error)}`,
      'infra:run-cron',
    );
  }
  if (!schedule) {
    throw new CliError(
      `"${job.name}" is not deployed in ${targetEnv} (no schedule ${scheduleName})`,
      'infra:run-cron',
      deployHint,
    );
  }
  const functionArn = schedule.Target?.Arn;
  const input = schedule.Target?.Input;
  if (!functionArn || input === undefined) {
    throw new CliError(
      `The schedule ${scheduleName} calls no job function`,
      'infra:run-cron',
      `Deploy it again: npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`,
    );
  }
  const functionName = functionArn.split(':').pop() ?? functionArn;

  logger.info(
    `Starting trigger "${job.name}" (${functionName} calls ${job.targetService}${job.endpoint}) in ${targetEnv}...`,
  );
  let answer;
  try {
    answer = await new LambdaClient(buildAWSClientConfig(credentials)).send(
      new InvokeCommand({
        FunctionName: functionArn,
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
        Payload: new TextEncoder().encode(input),
      }),
    );
  } catch (error) {
    if (
      (error as { name?: string } | null)?.name === 'ResourceNotFoundException'
    ) {
      throw new CliError(
        `"${job.name}" is not deployed in ${targetEnv} (no function ${functionName})`,
        'infra:run-cron',
        deployHint,
      );
    }
    throw new CliError(
      `Could not run "${job.name}": ${error instanceof Error ? error.message : String(error)}`,
      'infra:run-cron',
      logsHint,
    );
  }

  const payload = answer.Payload
    ? new TextDecoder().decode(answer.Payload)
    : '';
  // The end of the run's log (the job=<name> lines), up to 4 KB
  const logTail = answer.LogResult
    ? Buffer.from(answer.LogResult, 'base64').toString('utf8').trim()
    : '';
  const parsed = ((): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(payload);
      return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  })();

  logger.newline();
  const statusCode =
    typeof parsed.statusCode === 'number' ? parsed.statusCode : undefined;
  const body = typeof parsed.body === 'string' ? parsed.body : '';
  if (!answer.FunctionError && statusCode !== undefined && statusCode < 400) {
    logger.success(
      `"${job.name}" finished: ${statusCode} from ${job.targetService}${job.endpoint}`,
    );
    if (body) {
      logger.info(`Response: ${body.slice(0, RESPONSE_SHOWN_CHARS)}`);
    }
  } else {
    // The function threw ({ errorMessage }), or answered a refusal
    const reason = answer.FunctionError
      ? typeof parsed.errorMessage === 'string'
        ? parsed.errorMessage
        : payload
      : `${statusCode ?? 'no status'}${body ? ` (${body.slice(0, RESPONSE_SHOWN_CHARS)})` : ''}`;
    logger.error(`"${job.name}" failed: ${reason}`);
    if (logTail && options.lines !== false) {
      logger.info(logTail);
    }
    process.exitCode = 1;
  }
  logger.info(logsHint);
  logger.newline();
}
