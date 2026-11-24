/**
 * Find Azure Cron Job By Name
 *
 * The Container App Job deploys created for a cron job, by its tag
 * (AZURE_CRON_JOB_NAME_TAG), not by infrastructure.json: a job whose entry
 * was already removed is still found. The environment's resource group holds
 * only this project's resources.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import {
  AZURE_CRON_JOB_NAME_TAG,
  AZURE_RESOURCE_GROUP_SUFFIX,
} from '../../../constants';

export interface FindAzureCronJobByNameOptions {
  /** The cron job's config name */
  name: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

/**
 * @returns The Container App Job's name, or undefined when no job carries
 *   the cron job's tag (or the resource group doesn't exist)
 * @throws Azure's error when the jobs can't be listed
 */
export async function findAzureCronJobByName(
  options: FindAzureCronJobByNameOptions,
): Promise<string | undefined> {
  const { name, projectName, targetEnv, credentials } = options;
  const resourceGroupName = `${projectName}-${targetEnv}${AZURE_RESOURCE_GROUP_SUFFIX}`;
  const client = new ContainerAppsAPIClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );

  try {
    for await (const job of client.jobs.listByResourceGroup(
      resourceGroupName,
    )) {
      if (job.name && job.tags?.[AZURE_CRON_JOB_NAME_TAG] === name) {
        return job.name;
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return undefined;
    }
    throw error;
  }
  return undefined;
}
