/**
 * Scheduled job constants
 */

/**
 * Auth-service job that copies API key usage from Redis to Postgres and
 * rebuilds the Redis key index when it is missing (auth template projects).
 */
export const API_KEY_USAGE_SYNC_JOB_NAME = 'sync-api-key-usage';

/**
 * Path of the usage sync job on the auth-service, without its global prefix
 * (`POST /{globalPrefix}/jobs/sync-api-key-usage`).
 */
export const API_KEY_USAGE_SYNC_JOB_PATH = '/jobs/sync-api-key-usage';

/**
 * Suggested cron schedule for the usage sync job: every 5 minutes (week and
 * month totals and last-used times reach Postgres within minutes; a wiped
 * index is rebuilt at the next run at the latest).
 */
export const API_KEY_USAGE_SYNC_JOB_SCHEDULE = '*/5 * * * *';

/** Why each cloud's trigger httpTimeout stops where it does (validation hints) */
export const HTTP_TIMEOUT_LIMIT_REASONS = {
  gcp: 'Cloud Scheduler waits at most 30 minutes for a response.',
  aws: "The job invoker Lambda stops at 900 s and needs the last 10 s to log the run's end.",
  azure:
    'Container Apps ingress ends every HTTP request at 240 s, and jobs reach their service through it.',
} as const;

/** Why each cloud's cron job timeout stops where it does (validation hints) */
export const CRON_TIMEOUT_LIMIT_REASONS = {
  gcp: 'Cloud Run runs a job task for at most 7 days, and the platform gets the timeout plus a 60 s margin for the runner.',
  aws: 'The framework stops a run after a day (ECS has no limit of its own): a job past a day is stuck.',
  azure:
    'The framework stops a run after a day (Container Apps document no limit): a job past a day is stuck.',
} as const;

/** The migration job's AWS cpu values are ECS units; Fargate pairs are checked in vCPU */
export const ECS_CPU_UNITS_PER_VCPU = 1024;
