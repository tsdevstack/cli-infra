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
 * Cloud Run releases the subnet addresses of deleted services and jobs 1 to
 * 2 hours later (Google: "To delete the subnet, you must first delete or
 * redeploy your Cloud Run services, jobs, ... and then wait 1-2 hours").
 * Until then the subnet keeps a reserved `serverless-ipv4-*` address and
 * cannot be deleted. Terraform's error names that address.
 */
export const GCP_CLOUD_RUN_SUBNET_ADDRESS_PREFIX = 'serverless-ipv4-';
