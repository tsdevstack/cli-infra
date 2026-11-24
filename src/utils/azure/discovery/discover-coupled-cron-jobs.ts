/**
 * Discover Coupled Cron Jobs (Azure)
 *
 * Finds the Container App Jobs deploys created for a service's cron jobs:
 * the jobs tagged with the service's name (AZURE_CRON_JOB_SERVICE_TAG). They
 * run the service's image with its identity, so they go when the service
 * goes.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import {
  AZURE_CRON_JOB_NAME_TAG,
  AZURE_CRON_JOB_SERVICE_TAG,
  AZURE_RESOURCE_GROUP_SUFFIX,
} from '../../../constants';

export interface DiscoverCoupledCronJobsOptions {
  serviceName: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

export interface CoupledCronJobInfo {
  /** The cron job's config name */
  name: string;
  /** The Container App Job (`{project}-cron-{name}`) */
  jobName: string;
}

export async function discoverCoupledCronJobs(
  options: DiscoverCoupledCronJobsOptions,
): Promise<CoupledCronJobInfo[]> {
  const { serviceName, projectName, targetEnv, credentials } = options;
  const resourceGroupName = `${projectName}-${targetEnv}${AZURE_RESOURCE_GROUP_SUFFIX}`;
  const client = new ContainerAppsAPIClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );

  const jobs: CoupledCronJobInfo[] = [];
  try {
    for await (const job of client.jobs.listByResourceGroup(
      resourceGroupName,
    )) {
      if (job.name && job.tags?.[AZURE_CRON_JOB_SERVICE_TAG] === serviceName) {
        jobs.push({
          name: job.tags[AZURE_CRON_JOB_NAME_TAG] ?? job.name,
          jobName: job.name,
        });
      }
    }
  } catch (error) {
    // No resource group (404): nothing to delete here; any other error,
    // such as missing rights to list, is thrown
    if ((error as { statusCode?: number }).statusCode === 404) {
      return [];
    }
    throw error;
  }
  return jobs;
}
