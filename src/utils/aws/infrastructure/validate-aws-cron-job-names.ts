/**
 * Validate AWS Cron Job Names
 *
 * A cron job's EventBridge schedule is `{project}-{service}-{name}`, and
 * EventBridge Scheduler takes at most 64 characters for a schedule name (the
 * task family and log group allow far more). The check runs at
 * infra:generate, with the project and service names, so a name too long
 * stops here with the room left, not at deploy.
 */

import type { CronJobConfig } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { AWS_SCHEDULE_NAME_MAX_LENGTH } from '../../../constants';
import { buildAwsCronJobNames } from '../build-aws-cron-job-names';

/**
 * @param projectName - Project name from config.json
 * @param jobs - The environment's cron jobs
 * @param environment - Environment name for error messages
 * @throws CliError when a job's schedule name is over the limit
 */
export function validateAwsCronJobNames(
  projectName: string,
  jobs: CronJobConfig[],
  environment: string,
): void {
  const { CliError } = getContext();
  const max = AWS_SCHEDULE_NAME_MAX_LENGTH;

  for (const job of jobs) {
    const { scheduleName } = buildAwsCronJobNames(
      projectName,
      job.targetService,
      job.name,
    );
    if (scheduleName.length <= max) continue;
    const room = max - `${projectName}-${job.targetService}-`.length;
    throw new CliError(
      `${environment}.scheduledJobs.${job.name}: the EventBridge schedule name "${scheduleName}" is ${scheduleName.length} characters; AWS takes at most ${max}`,
      'Infrastructure Config',
      room > 0
        ? `With the project "${projectName}" and the service "${job.targetService}", a cron job name can be at most ${room} characters on AWS. Rename the job: register-cron with the new name, move the handler's code over, remove the old handler file and its entry.`
        : `The project and service names alone ("${projectName}-${job.targetService}-") leave no room for a cron job name on AWS. Shorten the project name in .tsdevstack/config.json.`,
    );
  }
}
