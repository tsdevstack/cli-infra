/**
 * Delete Container App Job
 *
 * Deletes an Azure Container App Job (scheduled CRON jobs).
 * Idempotent: Returns success if job doesn't exist.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';

export interface DeleteContainerAppJobOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  jobName: string;
}

export interface DeleteContainerAppJobResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an Azure Container App Job
 */
export async function deleteContainerAppJob(
  options: DeleteContainerAppJobOptions,
): Promise<DeleteContainerAppJobResult> {
  const { credentials, resourceGroupName, jobName } = options;
  const runtime = buildRuntime();

  const credential = createAzureCredential(runtime, credentials);

  const client = new ContainerAppsAPIClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    await client.jobs.beginDeleteAndWait(resourceGroupName, jobName);

    return { success: true, deleted: true };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };

    // 404 means already deleted
    if (error.statusCode === 404) {
      return { success: true, deleted: false };
    }

    return {
      success: false,
      deleted: false,
      error: error.message || 'Unknown error deleting Container App Job',
    };
  }
}
