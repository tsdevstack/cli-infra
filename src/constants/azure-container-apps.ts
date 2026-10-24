/**
 * Azure Container Apps constants
 */

/**
 * Name prefix of the database migration jobs deploys create with the SDK
 * (`migrate-{service}`). infra:destroy deletes these before Terraform; the
 * scheduled jobs (Terraform) are named `{project}-{job}`.
 */
export const AZURE_MIGRATION_JOB_PREFIX = 'migrate-';
