/**
 * Turn one Live Tail event into lines: one per read its log group serves
 * that the event belongs to.
 *
 * A session can hold several sources' log groups and takes one filter
 * pattern, so the event is matched here: by its log group's name, then, in
 * the groups several sources share, by what the
 * read's filter pattern picks (a job's lines: parseAwsJobEvent; a bucket's
 * events: the bucket's name). The level is the printer's.
 */

import type { LiveTailSessionLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import type { LogEntry } from '../../logs/types';
import { parseAwsAppEvent } from './parse-aws-app-event';
import { parseAwsBucketEvent } from './parse-aws-bucket-event';
import { parseAwsJobEvent } from './parse-aws-job-event';
import { parseAwsWafEvent } from './parse-aws-waf-event';
import type { AwsLiveTailSession } from './types';

export function parseAwsLiveTailEvent(
  event: LiveTailSessionLogEvent,
  session: AwsLiveTailSession,
): LogEntry[] {
  // AWS documents "the name or ARN", without its exact shape. A log group's
  // name has no colon, so the name is what follows the last one: the same
  // for a name, an ARN or `{account}:{name}`. One session is one account
  // and region, so the name is enough.
  const identifier = event.logGroupIdentifier ?? '';
  const name = identifier.slice(identifier.lastIndexOf(':') + 1);
  const group = session.logGroups.find((logGroup) => logGroup.name === name);
  if (!group) {
    return [];
  }

  const entries: LogEntry[] = [];
  for (const read of session.reads) {
    if (read.logGroupName !== group.name) {
      continue;
    }

    let entry: LogEntry | undefined;
    switch (read.format) {
      case 'job':
        entry = parseAwsJobEvent(event, read.source);
        break;
      case 'waf':
        entry = parseAwsWafEvent(event, read.source);
        break;
      case 'bucket': {
        let bucketName: unknown;
        try {
          const record = JSON.parse(event.message ?? '') as {
            requestParameters?: { bucketName?: unknown } | null;
          };
          bucketName = record.requestParameters?.bucketName;
        } catch {
          bucketName = undefined;
        }
        entry =
          bucketName === read.bucketName
            ? parseAwsBucketEvent(event, read.source)
            : undefined;
        break;
      }
      default:
        entry = parseAwsAppEvent(event, read.source);
    }

    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}
