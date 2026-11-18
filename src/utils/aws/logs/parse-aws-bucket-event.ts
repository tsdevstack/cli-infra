/**
 * Turn a CloudTrail S3 data event (the storage trail's CloudWatch line) into
 * a bucket access line: "GetObject avatars/u1.png by shop-auth-service-task
 * from 203.0.113.5", with CloudTrail's error code before "by" when the
 * access failed. Who: the role of an assumed-role session (a service's task
 * role, or the signer of a presigned URL), else the identity's ARN or type.
 * Level: done is info, refused or missing is warn, a failure on AWS's side
 * is error.
 *
 * The line's time is the request's (`eventTime`). The CloudWatch event's
 * timestamp is when CloudTrail delivered the record, minutes later, and is
 * used only when the record has no valid `eventTime`.
 */

import type { FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { formatBucketAccessLine } from '../../logs/format-bucket-access-line';
import type { LogEntry, LogSource } from '../../logs/types';

/** S3 error codes of a failure on AWS's side */
const SERVER_ERROR_CODES = new Set([
  'InternalError',
  'ServiceUnavailable',
  'SlowDown',
]);

interface CloudTrailRecord {
  eventTime?: string;
  eventName?: string;
  errorCode?: string;
  sourceIPAddress?: string;
  requestParameters?: { key?: string } | null;
  userIdentity?: {
    type?: string;
    arn?: string;
    sessionContext?: { sessionIssuer?: { userName?: string } };
  };
}

export function parseAwsBucketEvent(
  event: FilteredLogEvent,
  source: LogSource,
): LogEntry {
  const deliveredAt = new Date(event.timestamp ?? 0).toISOString();
  const text = event.message ?? '';

  let record: CloudTrailRecord;
  try {
    record = JSON.parse(text) as CloudTrailRecord;
  } catch {
    return {
      time: deliveredAt,
      source: source.name,
      kind: 'platform',
      message: text,
      raw: event,
    };
  }

  const identity = record.userIdentity ?? {};
  const errorCode = record.errorCode || undefined;
  const requestedAt = new Date(record.eventTime ?? Number.NaN);

  return {
    time: Number.isNaN(requestedAt.getTime())
      ? deliveredAt
      : requestedAt.toISOString(),
    source: source.name,
    kind: 'platform',
    level: !errorCode
      ? 'info'
      : SERVER_ERROR_CODES.has(errorCode)
        ? 'error'
        : 'warn',
    message: formatBucketAccessLine({
      operation: record.eventName ?? 'unknown',
      object: record.requestParameters?.key,
      error: errorCode,
      principal:
        identity.sessionContext?.sessionIssuer?.userName ??
        identity.arn ??
        identity.type,
      ip: record.sourceIPAddress,
    }),
    raw: event,
  };
}
