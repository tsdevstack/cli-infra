/**
 * A Cloud Storage Data Access audit entry as a bucket access line: the
 * method, the object, who (the identity, or the signer of a signed URL)
 * and the caller's address. Level from the access's status: done is info,
 * refused or missing is warn, a failure on Google's side is error.
 */

import type { logging_v2 } from 'googleapis';
import { formatBucketAccessLine } from '../../logs/format-bucket-access-line';
import type { LogLevel } from '../../logs/types';

/** gRPC codes of a failure on Google's side (unknown, deadline, internal, unavailable, data loss) */
const SERVER_ERROR_CODES = new Set([2, 4, 13, 14, 15]);

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export function formatGcpBucketAccess(entry: logging_v2.Schema$LogEntry): {
  level: LogLevel;
  message: string;
} {
  const payload = record(entry.protoPayload);
  const status = record(payload.status);
  const code = typeof status.code === 'number' ? status.code : 0;

  // projects/_/buckets/{bucket}/objects/{path}
  const resourceName = text(payload.resourceName) ?? '';
  const objectIndex = resourceName.indexOf('/objects/');
  const object =
    objectIndex === -1
      ? undefined
      : resourceName.slice(objectIndex + '/objects/'.length);

  return {
    level:
      code === 0 ? 'info' : SERVER_ERROR_CODES.has(code) ? 'error' : 'warn',
    message: formatBucketAccessLine({
      operation: text(payload.methodName) ?? 'unknown',
      object,
      error: code === 0 ? undefined : (text(status.message) ?? `code ${code}`),
      principal: text(record(payload.authenticationInfo).principalEmail),
      ip: text(record(payload.requestMetadata).callerIp),
    }),
  };
}
