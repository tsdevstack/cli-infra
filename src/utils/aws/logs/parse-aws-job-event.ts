/**
 * Turn a line of the scheduled job function into the shared shape, or
 * undefined when the line belongs to another job.
 *
 * The Node.js runtime writes "time<TAB>request ID<TAB>LEVEL<TAB>message";
 * our messages start with `job=<name> `.
 */

import type { FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { AWS_JOB_LINE_PREFIX } from '../../../constants';
import { normalizeLogLevel } from '../../logs/normalize-log-level';
import type { LogEntry, LogSource } from '../../logs/types';
import { buildAwsJobLineName } from './build-aws-job-line-name';

const RUNTIME_LINE = /^\S+\t\S+\t([A-Z]+)\t([\s\S]*)$/;

export function parseAwsJobEvent(
  event: FilteredLogEvent,
  source: LogSource,
): LogEntry | undefined {
  const text = (event.message ?? '').replace(/\r?\n$/, '');
  const match = RUNTIME_LINE.exec(text);
  const level = match ? normalizeLogLevel(match[1]) : undefined;
  const body = match ? match[2] : text;

  // "job=auth-service-cleanup-tokens" also matches "...-cleanup-tokens-weekly"
  const prefix = `${AWS_JOB_LINE_PREFIX}${buildAwsJobLineName(source)} `;
  if (!body.startsWith(prefix)) {
    return undefined;
  }

  return {
    time: new Date(event.timestamp ?? 0).toISOString(),
    source: source.name,
    kind: 'platform',
    level,
    message: body.slice(prefix.length),
    raw: event,
  };
}
