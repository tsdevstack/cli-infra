/**
 * List Container Apps
 *
 * Lists all Container Apps in a resource group.
 * Filters by project name prefix to find framework-managed apps.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

export interface ListContainerAppsOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  projectName: string;
}

export interface ContainerAppListItem {
  name: string;
  status: string;
  fqdn?: string;
  image?: string;
}

export interface ListContainerAppsResult {
  success: boolean;
  apps: ContainerAppListItem[];
  error?: string;
}

/**
 * List all Container Apps in a resource group
 */
export async function listContainerApps(
  options: ListContainerAppsOptions,
): Promise<ListContainerAppsResult> {
  const { credentials, resourceGroupName, projectName } = options;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new ContainerAppsAPIClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    const apps: ContainerAppListItem[] = [];
    const prefix = `${projectName}-`;

    for await (const app of client.containerApps.listByResourceGroup(
      resourceGroupName,
    )) {
      // Only include framework-managed apps (matching project prefix)
      if (app.name && app.name.startsWith(prefix)) {
        const firstContainer = app.template?.containers?.[0];

        apps.push({
          name: app.name,
          status: app.provisioningState ?? 'Unknown',
          fqdn: app.configuration?.ingress?.fqdn,
          image: firstContainer?.image,
        });
      }
    }

    return { success: true, apps };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      apps: [],
      error: error.message || 'Unknown error listing Container Apps',
    };
  }
}
