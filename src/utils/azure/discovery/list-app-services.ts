/**
 * List App Services
 *
 * Lists all Linux Web Apps in a resource group.
 * Filters by project name prefix to find framework-managed apps.
 */

import { WebSiteManagementClient } from '@azure/arm-appservice';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

export interface ListAppServicesOptions {
  credentials: AzureCredentials;
  resourceGroupName: string;
  projectName: string;
}

export interface AppServiceListItem {
  name: string;
  status: string;
  defaultHostName?: string;
  image?: string;
}

export interface ListAppServicesResult {
  success: boolean;
  apps: AppServiceListItem[];
  error?: string;
}

/**
 * List all App Service web apps in a resource group
 */
export async function listAppServices(
  options: ListAppServicesOptions,
): Promise<ListAppServicesResult> {
  const { credentials, resourceGroupName, projectName } = options;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new WebSiteManagementClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    const apps: AppServiceListItem[] = [];
    const prefix = `${projectName}-`;

    for await (const app of client.webApps.listByResourceGroup(
      resourceGroupName,
    )) {
      if (app.name && app.name.startsWith(prefix)) {
        const linuxFxVersion = app.siteConfig?.linuxFxVersion ?? '';
        const image = linuxFxVersion.startsWith('DOCKER|')
          ? linuxFxVersion.slice('DOCKER|'.length)
          : undefined;

        apps.push({
          name: app.name,
          status: app.state ?? 'Unknown',
          defaultHostName: app.defaultHostName,
          image,
        });
      }
    }

    return { success: true, apps };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      apps: [],
      error: error.message || 'Unknown error listing App Services',
    };
  }
}
