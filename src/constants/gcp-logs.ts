/**
 * GCP constants for infra:logs (Cloud Logging)
 */

/**
 * Entries per entries.list call. 1000 is the API's maximum; each call
 * counts against the 60 reads per minute per project.
 */
export const GCP_LOGS_PAGE_SIZE = 1000;

/**
 * Log IDs of a Cloud Run container's own output (stdout and stderr). Every
 * other log of a Cloud Run service or job (requests, system, audit) is a
 * platform line.
 */
export const GCP_RUN_APP_LOG_IDS = [
  'run.googleapis.com/stdout',
  'run.googleapis.com/stderr',
] as const;

/** OAuth scope for reading logs */
export const GCP_LOGGING_READ_SCOPE =
  'https://www.googleapis.com/auth/logging.read';

/** Name suffix of the load balancer's URL map (`{project}-urlmap`) */
export const GCP_URL_MAP_SUFFIX = '-urlmap';
