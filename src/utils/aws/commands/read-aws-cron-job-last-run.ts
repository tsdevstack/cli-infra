/**
 * A cron job's last run on AWS, from its log group
 *
 * ECS forgets a stopped task after about an hour, so the run's end comes
 * from the job's newest log stream (one per task): the runner's last line,
 * "cron job finished", with the outcome (A6).
 */

import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { CRON_FINISHED_MESSAGE } from '@tsdevstack/infra-core';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

/** The runner's outcomes as the list shows them */
const OUTCOMES: Record<string, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  stopped: 'Stopped',
  skipped: 'Skipped',
  unknown: 'Failed (unknown job)',
};

/** How many of the newest stream's last lines are searched for the end line */
const LAST_LINES = 50;

/**
 * @returns "Succeeded 2026-11-20T03:00:41.000Z", "never ran", or, for a
 *   newest run without its end line, "No end line (started ...)": running,
 *   or stopped before it could write one
 */
export async function readAwsCronJobLastRun(
  credentials: AWSCredentials,
  logGroupName: string,
): Promise<string> {
  const logs = new CloudWatchLogsClient(buildAWSClientConfig(credentials));

  let stream;
  try {
    const { logStreams } = await logs.send(
      new DescribeLogStreamsCommand({
        logGroupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 1,
      }),
    );
    stream = logStreams?.[0];
  } catch (error) {
    if (
      (error as { name?: string } | null)?.name === 'ResourceNotFoundException'
    ) {
      return 'never ran';
    }
    throw error;
  }
  if (!stream?.logStreamName) {
    return 'never ran';
  }

  const { events } = await logs.send(
    new GetLogEventsCommand({
      logGroupName,
      logStreamName: stream.logStreamName,
      startFromHead: false,
      limit: LAST_LINES,
    }),
  );
  for (const event of [...(events ?? [])].reverse()) {
    let line: { msg?: unknown; outcome?: unknown };
    try {
      line = JSON.parse(event.message ?? '') as typeof line;
    } catch {
      continue;
    }
    if (line.msg !== CRON_FINISHED_MESSAGE) continue;
    const outcome =
      typeof line.outcome === 'string'
        ? (OUTCOMES[line.outcome] ?? line.outcome)
        : 'Ended';
    return event.timestamp
      ? `${outcome} ${new Date(event.timestamp).toISOString()}`
      : outcome;
  }

  return stream.creationTime
    ? `No end line (started ${new Date(stream.creationTime).toISOString()})`
    : 'No end line';
}
