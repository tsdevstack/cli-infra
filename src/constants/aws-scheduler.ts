/**
 * EventBridge Scheduler (AWS schedules of both kinds of scheduled job)
 */

/** The schedule group the framework's schedules live in */
export const AWS_SCHEDULE_GROUP = 'default';

/** Longest EventBridge Scheduler schedule name */
export const AWS_SCHEDULE_NAME_MAX_LENGTH = 64;

/** startedBy of a cron job's task that infra:run-cron started */
export const AWS_RUN_CRON_STARTED_BY = 'tsdevstack-run-cron';
