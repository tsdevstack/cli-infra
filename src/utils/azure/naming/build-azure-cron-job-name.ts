import { CRON_JOB_NAME_PREFIX } from '@tsdevstack/infra-core';

/**
 * The Container App Job of a cron job: `{project}-cron-{name}`, next to the
 * triggers' `{project}-{name}` and the migration jobs' `migrate-{service}`.
 * At most 32 characters (validateAzureCronJobNames checks at generate).
 *
 * @param projectName - Project name from config.json
 * @param jobName - The cron job's name
 */
export function buildAzureCronJobName(
  projectName: string,
  jobName: string,
): string {
  return `${projectName}-${CRON_JOB_NAME_PREFIX}${jobName}`;
}
