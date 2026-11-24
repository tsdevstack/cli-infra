import { isCronJob, type ScheduledJobConfig } from '@tsdevstack/infra-core';
import { buildAzureCronJobName } from '../naming/build-azure-cron-job-name';
import { buildScheduledJobKey } from './build-scheduled-job-key';

/**
 * The Container App Job behind a scheduledJobs entry: a trigger's
 * `{project}-{name}` (Terraform), a cron job's `{project}-cron-{name}` (SDK)
 *
 * @param projectName - Project name from config.json
 * @param job - The entry
 */
export function buildAzureScheduledJobResourceName(
  projectName: string,
  job: ScheduledJobConfig,
): string {
  return isCronJob(job)
    ? buildAzureCronJobName(projectName, job.name)
    : `${projectName}-${buildScheduledJobKey(job.targetService, job.name)}`;
}
