/**
 * Build the Cloud Run Job name of a cron job
 */

import {
  buildGcpCloudRunName,
  CRON_JOB_NAME_PREFIX,
  type NamingScheme,
} from '@tsdevstack/infra-core';

/**
 * `cron-{name}` in a legacy environment, `{project}-cron-{name}` in the
 * unique scheme, next to the migration jobs' `migrate-{service}`. The
 * schedule that starts it keeps the trigger naming (`{project}-{name}`).
 *
 * @param projectName - Project name from config.json
 * @param jobName - The cron job's name
 * @param naming - The environment's naming scheme
 * @returns The Cloud Run Job name
 */
export function buildGcpCronJobName(
  projectName: string,
  jobName: string,
  naming: NamingScheme,
): string {
  return buildGcpCloudRunName(
    projectName,
    `${CRON_JOB_NAME_PREFIX}${jobName}`,
    naming,
  );
}
