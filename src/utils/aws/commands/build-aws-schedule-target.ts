/**
 * The Terraform address of a scheduled job's EventBridge schedule, for a
 * targeted apply: a trigger's in eventbridge.tf (keyed `{service}-{name}`),
 * a cron job's in cron-jobs.tf (keyed by its name). A cron job's apply also
 * creates its task definition, log group and the scheduler role.
 */

import { isCronJob, type ScheduledJobConfig } from '@tsdevstack/infra-core';
import { buildScheduledJobKey } from './build-scheduled-job-key';

export function buildAwsScheduleTarget(job: ScheduledJobConfig): string {
  return isCronJob(job)
    ? `aws_scheduler_schedule.cron_job["${job.name}"]`
    : `aws_scheduler_schedule.job["${buildScheduledJobKey(job.targetService, job.name)}"]`;
}
