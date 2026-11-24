/**
 * GCP Cloud Run constants
 */

/**
 * Name prefix of the database migration jobs deploys create with the SDK
 * (`migrate-{service}`). infra:destroy deletes these, together with the
 * Cloud Run services, before Terraform; the scheduled jobs belong to
 * Terraform (Cloud Scheduler).
 */
export const GCP_MIGRATION_JOB_PREFIX = 'migrate-';

/**
 * Name suffix of Kong's Cloud Run service (`{project}-kong`)
 */
export const GCP_KONG_SERVICE_SUFFIX = '-kong';

/**
 * Name suffix of the database setup Cloud Run job (`{project}-db-init`)
 */
export const GCP_DB_INIT_JOB_SUFFIX = '-db-init';

/**
 * Cloud Run releases the subnet addresses of deleted services and jobs 1 to
 * 2 hours later (Google: "To delete the subnet, you must first delete or
 * redeploy your Cloud Run services, jobs, ... and then wait 1-2 hours").
 * Until then the subnet keeps a reserved `serverless-ipv4-*` address and
 * cannot be deleted. Terraform's error names that address.
 */
export const GCP_CLOUD_RUN_SUBNET_ADDRESS_PREFIX = 'serverless-ipv4-';

/**
 * File name of an environment's Terraform state in the state bucket
 * (`{env}/default.tfstate`: the gcs backend's prefix is the environment and
 * the workspace is `default`)
 */
export const GCP_TERRAFORM_STATE_FILE = 'default.tfstate';

/**
 * Cloud Storage's JSON API: an object's content is
 * `{url}/b/{bucket}/o/{object}?alt=media`
 */
export const GCS_JSON_API_URL = 'https://storage.googleapis.com/storage/v1';

/**
 * Labels on the Cloud Run Jobs deploys create for cron jobs
 * (`{project}-cron-{job}`): the service whose image runs, and the job's
 * config name. remove-service finds a service's cron jobs by them.
 */
export const GCP_CRON_JOB_SERVICE_LABEL = 'tsdevstack-cron-service';
export const GCP_CRON_JOB_NAME_LABEL = 'tsdevstack-cron-job';
