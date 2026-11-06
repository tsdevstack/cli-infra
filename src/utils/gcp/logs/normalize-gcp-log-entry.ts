/**
 * Turn a Cloud Logging entry into the shared line shape.
 *
 * - Source: the Cloud Run service or job, the Cloud Scheduler job, or edge
 *   for the load balancer. Kong's `{project}-kong` shows as kong.
 * - Kind: a Cloud Run container's stdout and stderr are app lines; every
 *   other Cloud Run log and Cloud Scheduler's run logs are platform lines;
 *   the load balancer's are edge lines.
 * - Level: app lines use our pino level (jsonPayload.level); plain text
 *   output has none. Platform and edge lines use Cloud Logging's severity.
 */

import type { logging_v2 } from 'googleapis';
import {
  GCP_KONG_SERVICE_SUFFIX,
  GCP_RUN_APP_LOG_IDS,
  EDGE_LOG_SOURCE,
  KONG_LOG_SOURCE,
} from '../../../constants';
import { normalizeLogLevel } from '../../logs/normalize-log-level';
import { parseJsonLogPayload } from '../../logs/parse-json-log-payload';
import type { LogEntry, LogKind } from '../../logs/types';
import { formatGcpHttpRequest } from './format-gcp-http-request';

export function normalizeGcpLogEntry(
  entry: logging_v2.Schema$LogEntry,
  projectName: string,
): LogEntry {
  const resourceType = entry.resource?.type ?? '';
  const labels = entry.resource?.labels ?? {};
  const payload: Record<string, unknown> | undefined =
    entry.jsonPayload ?? undefined;

  // Source
  let source: string;
  if (resourceType === 'cloud_run_revision') {
    const name = labels.service_name ?? '';
    source =
      name === `${projectName}${GCP_KONG_SERVICE_SUFFIX}`
        ? KONG_LOG_SOURCE
        : name;
  } else if (resourceType === 'cloud_run_job') {
    source = labels.job_name ?? '';
  } else if (resourceType === 'cloud_scheduler_job') {
    source = labels.job_id ?? '';
  } else if (resourceType === 'http_load_balancer') {
    source = EDGE_LOG_SOURCE;
  } else {
    source = resourceType || 'unknown';
  }

  // Kind
  const logId = decodeURIComponent(
    (entry.logName ?? '').split('/logs/')[1] ?? '',
  );
  let kind: LogKind;
  if (resourceType === 'http_load_balancer') {
    kind = 'edge';
  } else if ((GCP_RUN_APP_LOG_IDS as readonly string[]).includes(logId)) {
    kind = 'app';
  } else {
    kind = 'platform';
  }

  const time = new Date(
    entry.timestamp ?? entry.receiveTimestamp ?? 0,
  ).toISOString();

  // App lines: our pino JSON, other JSON, or plain text
  if (kind === 'app') {
    if (payload) {
      return {
        time,
        source,
        kind,
        ...parseJsonLogPayload(payload, entry.severity),
        raw: entry,
      };
    }
    return {
      time,
      source,
      kind,
      message: entry.textPayload ?? '',
      raw: entry,
    };
  }

  // Platform and edge lines
  let message: string;
  const rawType = payload?.['@type'];
  const payloadType = typeof rawType === 'string' ? rawType : '';
  if (resourceType === 'cloud_scheduler_job') {
    const url = typeof payload?.url === 'string' ? payload.url : '';
    // Cloud Scheduler stamps its entries when it writes them, up to seconds
    // after the run started; the start entry names the scheduled time
    if (payloadType.endsWith('AttemptStarted')) {
      const scheduled =
        typeof payload?.scheduledTime === 'string'
          ? ` (scheduled ${payload.scheduledTime.replace('T', ' ').replace(/\.\d+Z$|Z$/, '')})`
          : '';
      message = `Run started${scheduled}: ${url}`;
    } else if (payloadType.endsWith('AttemptFinished')) {
      const status = entry.httpRequest?.status ?? payload?.status;
      const failed =
        normalizeLogLevel(entry.severity) === 'error' ||
        (typeof status === 'number' && status >= 400);
      // Google's detail ("URL_ERROR-ERROR_NOT_FOUND ...") only for failures
      const detail =
        failed && typeof payload?.debugInfo === 'string'
          ? ` (${payload.debugInfo})`
          : '';
      message = `Run finished: ${status ?? 'no status'}${detail}`;
    } else {
      message = entry.textPayload ?? JSON.stringify(payload ?? {});
    }
  } else if (
    entry.httpRequest &&
    (entry.httpRequest.requestMethod || entry.httpRequest.requestUrl)
  ) {
    message = formatGcpHttpRequest(entry.httpRequest, {
      includeHost: kind === 'edge',
    });
    // The load balancer says why it answered itself: a Cloud Armor block
    // (with the matched rule, for chasing false positives), or a backend
    // that did not answer (502)
    const policy = payload?.enforcedSecurityPolicy as
      Record<string, unknown> | undefined;
    const details = payload?.statusDetails;
    if (policy && policy.outcome === 'DENY') {
      const rules = Array.isArray(policy.preconfiguredExprIds)
        ? ` (${policy.preconfiguredExprIds.join(', ')})`
        : '';
      message += ` blocked by ${String(policy.name)} rule ${String(policy.priority)}${rules}`;
    } else if (
      typeof details === 'string' &&
      details !== 'response_sent_by_backend'
    ) {
      message += ` (${details})`;
    }
  } else if (entry.textPayload) {
    message = entry.textPayload;
  } else if (
    entry.protoPayload &&
    typeof entry.protoPayload.methodName === 'string'
  ) {
    const status = entry.protoPayload.status as
      Record<string, unknown> | undefined;
    message = entry.protoPayload.methodName;
    if (status && typeof status.message === 'string' && status.message) {
      message += `: ${status.message}`;
    }
  } else if (typeof payload?.message === 'string') {
    message = payload.message;
  } else {
    message = JSON.stringify(payload ?? {});
  }

  return {
    time,
    source,
    kind,
    level: normalizeLogLevel(entry.severity),
    message,
    raw: entry,
  };
}
