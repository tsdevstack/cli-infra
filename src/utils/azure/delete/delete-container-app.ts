/**
 * Delete Container App
 *
 * Deletes an Azure Container App.
 * Idempotent: Returns success if Container App doesn't exist.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';

export interface DeleteContainerAppOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  containerAppName: string;
}

export interface DeleteContainerAppResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Delete an Azure Container App
 */
export async function deleteContainerApp(
  options: DeleteContainerAppOptions,
): Promise<DeleteContainerAppResult> {
  const { credentials, resourceGroupName, containerAppName } = options;
  const runtime = buildRuntime();

  const credential = createAzureCredential(runtime, credentials);

  const client = new ContainerAppsAPIClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    // Verify the Container App exists before attempting deletion
    // Azure's beginDeleteAndWait silently succeeds for non-existent resources
    await client.containerApps.get(resourceGroupName, containerAppName);
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };
    if (error.statusCode === 404) {
      return { success: true, deleted: false };
    }
    return {
      success: false,
      deleted: false,
      error: error.message || 'Unknown error checking Container App',
    };
  }

  try {
    await client.containerApps.beginDeleteAndWait(
      resourceGroupName,
      containerAppName,
    );

    return { success: true, deleted: true };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };

    return {
      success: false,
      deleted: false,
      error: error.message || 'Unknown error deleting Container App',
    };
  }
}
