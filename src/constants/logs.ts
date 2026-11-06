/**
 * infra:logs constants
 */

/**
 * Log levels from lowest to highest. `--level warn` shows warn, error and
 * fatal. pino's trace level counts as debug.
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

/**
 * Where a line comes from: the app itself, the platform running it (Cloud Run,
 * ECS, Container Apps), or the edge in front of it (load balancer, WAF).
 */
export const LOG_KINDS = ['app', 'platform', 'edge'] as const;

/** Time window start when --since is not given */
export const DEFAULT_LOGS_SINCE = '1h';

/**
 * How far back the source list looks for each source's last line. Matches
 * the shortest default retention of the three clouds (Cloud Logging's
 * _Default bucket keeps 30 days).
 */
export const LOG_SOURCE_LIST_WINDOW_DAYS = 30;

/** Source name of Kong's logs on every provider */
export const KONG_LOG_SOURCE = 'kong';

/** Source name of the load balancer and WAF logs on every provider */
export const EDGE_LOG_SOURCE = 'edge';

/** Name prefix of migration runs on every provider (`migrate-{service}`) */
export const MIGRATION_LOG_SOURCE_PREFIX = 'migrate-';

/** ANSI colors for the human output (only when writing to a terminal) */
export const LOG_COLORS = {
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  magenta: '\u001b[35m',
  reset: '\u001b[0m',
} as const;

/**
 * pino's own fields on our NestJS lines: shown elsewhere in a line (level,
 * time, message, service) or not at all (pid, hostname)
 */
export const PINO_BASE_FIELDS = [
  'level',
  'time',
  'msg',
  'pid',
  'hostname',
  'service',
] as const;
