/**
 * Azure Container Apps constants
 */

/**
 * Name prefix of the database migration jobs deploys create with the SDK
 * (`migrate-{service}`). infra:destroy deletes these before Terraform; the
 * scheduled jobs (Terraform) are named `{project}-{job}`.
 */
export const AZURE_MIGRATION_JOB_PREFIX = 'migrate-';

/**
 * The db-init job deploys create with the SDK (one per environment): sets up
 * each database service's owner and app role. infra:destroy deletes it with
 * the migration jobs.
 */
export const AZURE_DB_INIT_JOB_NAME = 'db-init';

/**
 * Status checks (5 seconds apart) a job's new execution may take to show
 * up in its list after the start, before the CLI says it never started
 */
export const AZURE_JOB_START_WAIT_POLLS = 12;

/**
 * States a Container Apps Job execution ends in
 */
export const AZURE_JOB_EXECUTION_END_STATES: ReadonlySet<string> = new Set([
  'Succeeded',
  'Failed',
  'Stopped',
  'Degraded',
  'Unknown',
]);

/**
 * Seconds a new execution may take before its container runs (scheduling,
 * image pull: 35 to 88 s with a 700 MB image on az7, 2026-11-23), added to
 * the wait on top of the job's replicaTimeout, which limits the run itself.
 * Azure counts replicaTimeout from the run's creation, so a cron job's
 * replicaTimeout has it too (buildAzureCronJobPlatformTimeout).
 */
export const AZURE_JOB_START_MARGIN_SECONDS = 300;

/**
 * Times Azure may start a job run again after a failed start. Only for runs
 * that are safe twice at once (db-init's init, a migration: Prisma locks
 * the migrations table): a run Azure counted as failed before its
 * container had started still ran afterwards (az7, 2026-11-23), so a
 * second start may run beside it. Restore, remove and export keep none.
 */
export const AZURE_REPEATABLE_JOB_RETRIES = 1;

/** Seconds between two status reads of a running job execution */
export const AZURE_JOB_EXECUTION_POLL_SECONDS = 5;

/**
 * Status reads of a running execution that may fail in a row (network)
 * before the wait gives up
 */
export const AZURE_JOB_EXECUTION_READ_ATTEMPTS = 3;

/**
 * Tags on the Container App Jobs deploys create for cron jobs
 * (`{project}-cron-{job}`): the service whose image runs, and the job's
 * config name. remove-service and infra:destroy find the jobs by them.
 */
export const AZURE_CRON_JOB_SERVICE_TAG = 'tsdevstack-cron-service';
export const AZURE_CRON_JOB_NAME_TAG = 'tsdevstack-cron-job';
