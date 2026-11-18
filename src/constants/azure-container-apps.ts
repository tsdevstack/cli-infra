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
 * image pull: about 30 s on Azure in November 2026), added to the wait on
 * top of the job's replicaTimeout, which limits the run itself
 */
export const AZURE_JOB_START_MARGIN_SECONDS = 300;

/** Seconds between two status reads of a running job execution */
export const AZURE_JOB_EXECUTION_POLL_SECONDS = 5;

/**
 * Status reads of a running execution that may fail in a row (network)
 * before the wait gives up
 */
export const AZURE_JOB_EXECUTION_READ_ATTEMPTS = 3;
