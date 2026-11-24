import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';

/**
 * The image a deployed Container App runs (its first container's), or
 * undefined when the app doesn't exist. deploy-schedulers gives a cron job
 * the image its service runs, so no build or tag is needed there.
 *
 * @param credentials - The environment's Azure credentials
 * @param resourceGroupName - The environment's resource group
 * @param containerAppName - The Container App (`{project}-{service}`)
 */
export async function getDeployedContainerAppImage(
  credentials: AzureCredentials,
  resourceGroupName: string,
  containerAppName: string,
): Promise<string | undefined> {
  const client = new ContainerAppsAPIClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );
  try {
    const app = await client.containerApps.get(
      resourceGroupName,
      containerAppName,
    );
    return app.template?.containers?.[0]?.image ?? undefined;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return undefined;
    }
    throw error;
  }
}
