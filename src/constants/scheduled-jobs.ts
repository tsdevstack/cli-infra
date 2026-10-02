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
