/**
 * The database job on AWS (db-init, a one-off ECS task) when it saves or
 * restores a service's database
 */

/** Container name in the db-init task definition (db-init.tf) */
export const AWS_DB_INIT_CONTAINER_NAME = 'db-init';

/** How often the CLI asks ECS whether the task has stopped */
export const AWS_DB_JOB_POLL_MS = 5_000;

/**
 * ECS has no time limit for a task: the CLI waits the job's limit plus this
 * (the task's start), then stops it
 */
export const AWS_DB_JOB_START_MARGIN_SECONDS = 120;

/** Status checks in a row that may fail (a network drop) before the CLI gives up */
export const AWS_DB_JOB_STATUS_ERRORS_ALLOWED = 5;

/** Lines of the task's log read when it fails */
export const AWS_DB_JOB_LOG_LINES = 50;
