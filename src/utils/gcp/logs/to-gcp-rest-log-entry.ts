/**
 * Turn an entry from Cloud Logging's tail stream into the shape entries.list
 * (REST) returns, so one function (normalizeGcpLogEntry) turns both into
 * lines.
 *
 * The tail stream is gRPC. @google-cloud/logging hands over each entry as
 * the decoded message (`metadata`) plus its payload (`data`):
 * - every field is there, unset ones with their default (empty text, false,
 *   0, severity DEFAULT); REST leaves them out
 * - timestamps and durations are objects (`{ seconds, nanos }`, or a Date
 *   for `timestamp`); REST writes text ("2026-11-10T12:00:00.123Z", "0.012s")
 * - the payload's field name is in `metadata.payload`; `data` holds the
 *   payload, jsonPayload already as plain JSON
 * - protoPayload is encoded; audit entries are decoded (decodeGcpAuditLog)
 */

import type { logging_v2 } from 'googleapis';
import { decodeGcpAuditLog } from './decode-gcp-audit-log';
import { formatGcpProtoDuration } from './format-gcp-proto-duration';
import { formatGcpProtoTimestamp } from './format-gcp-proto-timestamp';
import { omitGcpProtoDefaults } from './omit-gcp-proto-defaults';
import type { GcpTailEntry } from './types';

export function toGcpRestLogEntry(
  entry: GcpTailEntry,
): logging_v2.Schema$LogEntry {
  const {
    payload,
    jsonPayload,
    textPayload,
    protoPayload,
    timestamp,
    receiveTimestamp,
    httpRequest,
    ...rest
  } = entry.metadata;

  const result = (omitGcpProtoDefaults(rest) ?? {}) as Record<string, unknown>;
  // DEFAULT is the severity's unset value, which REST leaves out too
  if (result.severity === 'DEFAULT') {
    delete result.severity;
  }

  const time = formatGcpProtoTimestamp(timestamp);
  if (time) {
    result.timestamp = time;
  }
  const received = formatGcpProtoTimestamp(receiveTimestamp);
  if (received) {
    result.receiveTimestamp = received;
  }

  if (httpRequest && typeof httpRequest === 'object') {
    const { latency, ...fields } = httpRequest as Record<string, unknown>;
    const request = (omitGcpProtoDefaults(fields) ?? {}) as Record<
      string,
      unknown
    >;
    const duration = formatGcpProtoDuration(latency);
    if (duration) {
      request.latency = duration;
    }
    if (Object.keys(request).length > 0) {
      result.httpRequest = request;
    }
  }

  // The payload: from `data` (what the SDK made of it), else the message
  const kind =
    payload ??
    (jsonPayload ? 'jsonPayload' : protoPayload ? 'protoPayload' : undefined) ??
    (textPayload ? 'textPayload' : undefined);
  const data = entry.data as unknown;
  if (kind === 'jsonPayload') {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      result.jsonPayload = data;
    }
  } else if (kind === 'protoPayload') {
    const decoded = decodeGcpAuditLog(data ?? protoPayload);
    if (decoded) {
      result.protoPayload = decoded;
    }
  } else if (kind === 'textPayload') {
    const text = typeof data === 'string' ? data : textPayload;
    if (typeof text === 'string' && text !== '') {
      result.textPayload = text;
    }
  }

  return result as logging_v2.Schema$LogEntry;
}
