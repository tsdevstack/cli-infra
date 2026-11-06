/**
 * Build the Cloud Logging filter for one log source, limited to a kind and
 * a level when given. Returns undefined when the source has no lines of the
 * requested kind.
 *
 * - Services, workers, frontends, Kong: Cloud Run services. stdout and
 *   stderr are app lines; requests, system and audit logs are platform lines.
 * - Migrations: Cloud Run jobs, split the same way.
 * - Scheduled jobs: Cloud Scheduler's run logs (platform lines).
 * - Edge: the load balancer's request logs, with Cloud Armor's decisions.
 *
 * App lines carry our pino level (jsonPayload.level); platform and edge
 * lines carry Cloud Logging's severity.
 */

import {
  GCP_KONG_SERVICE_SUFFIX,
  GCP_RUN_APP_LOG_IDS,
  GCP_URL_MAP_SUFFIX,
  LOG_LEVELS,
} from '../../../constants';
import type { LogKind, LogLevel, LogSource } from '../../logs/types';

/** pino labels at or above each level (pino's trace counts as debug) */
const PINO_LABELS: Record<LogLevel, string[]> = {
  debug: ['trace', 'debug'],
  info: ['info'],
  warn: ['warn'],
  error: ['error'],
  fatal: ['fatal'],
};

const SEVERITIES: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export function buildGcpLogSourceFilter(
  source: LogSource,
  projectName: string,
  options: { kind?: LogKind; level?: LogLevel },
): string | undefined {
  const { kind, level } = options;

  let resource: string;
  let kinds: LogKind[];
  switch (source.type) {
    case 'kong':
      resource = `resource.type="cloud_run_revision" AND resource.labels.service_name="${projectName}${GCP_KONG_SERVICE_SUFFIX}"`;
      kinds = ['app', 'platform'];
      break;
    case 'migration':
      resource = `resource.type="cloud_run_job" AND resource.labels.job_name="${source.name}"`;
      kinds = ['app', 'platform'];
      break;
    case 'job':
      resource = `resource.type="cloud_scheduler_job" AND resource.labels.job_id="${source.name}"`;
      kinds = ['platform'];
      break;
    case 'edge':
      resource = `resource.type="http_load_balancer" AND resource.labels.url_map_name="${projectName}${GCP_URL_MAP_SUFFIX}"`;
      kinds = ['edge'];
      break;
    default:
      resource = `resource.type="cloud_run_revision" AND resource.labels.service_name="${source.name}"`;
      kinds = ['app', 'platform'];
  }

  const wanted = kind ? kinds.filter((k) => k === kind) : kinds;
  if (wanted.length === 0) {
    return undefined;
  }

  // Every line of the source: no need to split it by kind
  if (wanted.length === kinds.length && !level) {
    return `(${resource})`;
  }

  const severity = level ? `severity>=${SEVERITIES[level]}` : undefined;
  const appOutput = `(${GCP_RUN_APP_LOG_IDS.map((id) => `log_id("${id}")`).join(' OR ')})`;

  const parts = wanted.map((k) => {
    const conditions: string[] = [];
    if (k === 'app') {
      conditions.push(appOutput);
      if (level) {
        const labels = LOG_LEVELS.slice(LOG_LEVELS.indexOf(level)).flatMap(
          (l) => PINO_LABELS[l],
        );
        conditions.push(
          `(${labels.map((label) => `jsonPayload.level="${label}"`).join(' OR ')})`,
        );
      }
    } else {
      // A Cloud Run source's platform lines are everything but its own output
      if (kinds.includes('app')) {
        conditions.push(`NOT ${appOutput}`);
      }
      if (severity) {
        conditions.push(severity);
      }
    }
    return conditions.join(' AND ');
  });

  const nonEmpty = parts.filter(Boolean);
  if (nonEmpty.length === 0) {
    return `(${resource})`;
  }
  const byKind =
    nonEmpty.length === 1
      ? nonEmpty[0]
      : nonEmpty.map((p) => `(${p})`).join(' OR ');
  return `(${resource} AND (${byKind}))`;
}
