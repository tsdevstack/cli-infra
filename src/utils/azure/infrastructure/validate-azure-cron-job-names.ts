/**
 * Validate Azure Cron Job Names
 *
 * A cron job's Container App Job is `{project}-cron-{name}`, and Azure takes
 * at most 32 characters for a Container App Job name. The check runs at
 * infra:generate, with the project name, so a name too long stops here with
 * the room this project leaves, not at deploy.
 */

import {
  AZURE_NAME_MAX_LENGTH,
  CRON_JOB_NAME_PREFIX,
  type CronJobConfig,
} from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildAzureCronJobName } from '../naming/build-azure-cron-job-name';

/**
 * @param projectName - Project name from config.json
 * @param jobs - The environment's cron jobs
 * @param environment - Environment name for error messages
 * @throws CliError when a job's Container App Job name is over the limit
 */
export function validateAzureCronJobNames(
  projectName: string,
  jobs: CronJobConfig[],
  environment: string,
): void {
  const { CliError } = getContext();
  const max = AZURE_NAME_MAX_LENGTH.containerAppJob;
  const room = max - `${projectName}-${CRON_JOB_NAME_PREFIX}`.length;

  for (const job of jobs) {
    const name = buildAzureCronJobName(projectName, job.name);
    if (name.length <= max) continue;
    throw new CliError(
      `${environment}.scheduledJobs.${job.name}: the Container App Job name "${name}" is ${name.length} characters; Azure takes at most ${max}`,
      'Infrastructure Config',
      room > 0
        ? `With the project name "${projectName}", a cron job name can be at most ${room} characters on Azure. Rename the job: register-cron with the new name, move the handler's code over, remove the old handler file and its entry.`
        : `The project name "${projectName}" leaves no room for a cron job name on Azure.`,
    );
  }
}
