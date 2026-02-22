/**
 * Set App Settings on Azure App Service
 *
 * Merges the provided settings into existing app settings.
 * Uses the @azure/arm-appservice SDK.
 */

import { WebSiteManagementClient } from '@azure/arm-appservice';
import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

export async function setAppServiceSettings(
  credentials: AzureCredentials,
  resourceGroupName: string,
  appServiceName: string,
  settings: Record<string, string>,
): Promise<void> {
  const { CliError } = getContext();

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new WebSiteManagementClient(
    credential,
    credentials.subscriptionId,
  );

  try {
    // SDK's updateApplicationSettings replaces all settings, so merge with existing
    const currentSettings = await client.webApps.listApplicationSettings(
      resourceGroupName,
      appServiceName,
    );

    await client.webApps.updateApplicationSettings(
      resourceGroupName,
      appServiceName,
      {
        properties: {
          ...currentSettings.properties,
          ...settings,
        },
      },
    );
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new CliError(
      `Failed to set app settings on App Service "${appServiceName}"`,
      'set-app-service-settings',
      error.message ?? 'Unknown error',
    );
  }
}
