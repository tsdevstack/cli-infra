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
 * --follow stops by itself after this many hours (--no-time-limit: until
 * Ctrl+C). AWS bills Live Tail per minute, so a forgotten terminal stops.
 */
export const LOGS_FOLLOW_TIME_LIMIT_HOURS = 1;

/** --follow: tries to open a dropped stream again before it gives up */
export const LOGS_FOLLOW_RECONNECT_TRIES = 3;

/** --follow: wait between two tries to open a stream */
export const LOGS_FOLLOW_RECONNECT_DELAY_MS = 5000;

/** infra:run-cron: how many of a failed run's newest lines it prints */
export const FAILED_RUN_LOG_LINES = 50;

/**
 * infra:run-cron: wait before each read of a failed run's lines. The clouds
 * make a run's last lines readable some seconds after it ended, and not in
 * order: on GCP the exit line was readable while the five lines before it
 * (the error among them) were not yet.
 */
export const FAILED_RUN_LOG_WAIT_MS = 3000;

/**
 * infra:run-cron: how often a failed run's lines are read until the
 * runner's last line ("cron job finished") is among them. A process that
 * was killed never writes it: then the lines of the last read are shown.
 */
export const FAILED_RUN_LOG_READ_TRIES = 5;

/**
 * infra:run-cron: seconds added on both sides of a failed run's time
 * window. The window comes from this machine's clock, the lines' times from
 * the cloud's; the two can differ.
 */
export const FAILED_RUN_LOG_CLOCK_MARGIN_SECONDS = 60;

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

/**
 * Source name of the database setup job (db-init) on every provider: the
 * job infra:deploy runs to create the database roles
 */
export const DB_INIT_LOG_SOURCE = 'db-init';

/**
 * Name prefix of a storage bucket's access log on every provider
 * (`bucket-{name}`, the name in config.json)
 */
export const BUCKET_LOG_SOURCE_PREFIX = 'bucket-';

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
