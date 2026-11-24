import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { findAzureCronJobByName } from '../discovery/find-azure-cron-job-by-name';
import { buildAzureScheduledJobResourceName } from './build-azure-scheduled-job-resource-name';

/**
 * The Container App Job a `--job` value means:
 * 1. the entry of that name in the environment's scheduledJobs (a trigger's
 *    `{project}-{name}`, a cron job's `{project}-cron-{name}`);
 * 2. otherwise a cron job deployed with that name, found by its tag, so a
 *    job whose entry was already removed is found too;
 * 3. otherwise the value itself, as the resource name.
 *
 * @param projectName - Project name from config.json
 * @param targetEnv - Environment
 * @param jobOption - The --job value
 * @param credentials - Azure credentials, for the tag lookup
 * @throws Azure's error when the jobs can't be listed
 */
export async function resolveAzureScheduledJobResourceName(
  projectName: string,
  targetEnv: string,
  jobOption: string,
  credentials: AzureCredentials,
): Promise<string> {
  const job = getScheduledJobs(loadInfrastructureConfig(), targetEnv).find(
    (entry) => entry.name === jobOption,
  );
  if (job) {
    return buildAzureScheduledJobResourceName(projectName, job);
  }
  const tagged = await findAzureCronJobByName({
    name: jobOption,
    projectName,
    targetEnv,
    credentials,
  });
  return tagged ?? jobOption;
}
