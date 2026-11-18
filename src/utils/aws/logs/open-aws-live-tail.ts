/**
 * One CloudWatch Live Tail session for --follow: lines as they arrive, until
 * the session ends or the signal aborts.
 *
 * - Open once AWS sends the session's start.
 * - AWS sends an update every second; above 500 matching lines a second it
 *   sends a sample (said once per session).
 * - AWS ends a session after 3 hours (`dropped`: followLogStream opens a new
 *   one, with --no-time-limit). Its own streaming error, a dropped
 *   connection or a refused start are errors.
 */

import {
  StartLiveTailCommand,
  type CloudWatchLogsClient,
} from '@aws-sdk/client-cloudwatch-logs';
import { getContext } from '../../../context';
import type { LogsFollowHandlers, LogStreamEnd } from '../../logs/types';
import { parseAwsLiveTailEvent } from './parse-aws-live-tail-event';
import type { AwsLiveTailSession } from './types';

export async function openAwsLiveTail(params: {
  client: CloudWatchLogsClient;
  session: AwsLiveTailSession;
  handlers: LogsFollowHandlers;
  onOpen: () => void;
  signal: AbortSignal;
}): Promise<LogStreamEnd> {
  const { CliError } = getContext();
  const { client, session, handlers, onOpen, signal } = params;
  let sampleSaid = false;

  try {
    const response = await client.send(
      new StartLiveTailCommand({
        logGroupIdentifiers: session.logGroups.map((group) => group.arn),
        ...(session.filterPattern && {
          logEventFilterPattern: session.filterPattern,
        }),
      }),
      { abortSignal: signal },
    );

    for await (const event of response.responseStream ?? []) {
      if (event.sessionStart) {
        onOpen();
      } else if (event.sessionUpdate) {
        const entries = (event.sessionUpdate.sessionResults ?? []).flatMap(
          (result) => parseAwsLiveTailEvent(result, session),
        );
        if (entries.length > 0) {
          handlers.onEntries(entries);
        }
        if (event.sessionUpdate.sessionMetadata?.sampled && !sampleSaid) {
          sampleSaid = true;
          handlers.onNotice(
            'Live Tail is showing a sample: more than 500 lines a second match (AWS sends at most 500).',
          );
        }
      } else if (event.SessionTimeoutException) {
        return 'dropped';
      } else if (event.SessionStreamingException) {
        throw new CliError(
          `Live Tail stopped: ${event.SessionStreamingException.message ?? 'unknown error'}`,
          'infra:logs --follow',
        );
      }
    }
    return 'dropped';
  } catch (error) {
    if (signal.aborted) {
      return 'dropped';
    }
    if (error instanceof CliError) {
      throw error;
    }
    const name = (error as { name?: string } | undefined)?.name;
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Cannot follow CloudWatch Logs: ${message}`,
      'infra:logs --follow',
      name === 'AccessDeniedException'
        ? 'The deploy credentials need logs:StartLiveTail.'
        : name === 'LimitExceededException'
          ? 'AWS allows 15 Live Tail sessions at once per account and region (the console counts too). Close one, or ask AWS for more in Service Quotas.'
          : undefined,
    );
  }
}
