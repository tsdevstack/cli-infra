/**
 * Deploy Container Image to Azure App Service
 *
 * Updates an App Service's container image and restarts it.
 * Uses the @azure/arm-appservice SDK.
 */

import { WebSiteManagementClient } from '@azure/arm-appservice';
import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

interface DeployAppServiceParams {
  credentials: AzureCredentials;
  resourceGroupName: string;
  appServiceName: string;
  acrLoginServer: string;
  imageUri: string;
}

export async function deployAppService(
  params: DeployAppServiceParams,
): Promise<void> {
  const { CliError } = getContext();
  const {
    credentials,
    resourceGroupName,
    appServiceName,
    acrLoginServer,
    imageUri,
  } = params;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new WebSiteManagementClient(
    credential,
    credentials.subscriptionId,
  );

  // Step 1: Update container image in site config
  try {
    await client.webApps.updateConfiguration(
      resourceGroupName,
      appServiceName,
      { linuxFxVersion: `DOCKER|${imageUri}` },
    );
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new CliError(
      `Failed to set container image on App Service "${appServiceName}"`,
      'deploy-app-service',
      error.message ?? 'Unknown error',
    );
  }

  // Step 2: Ensure registry URL is set in app settings
  // SDK's updateApplicationSettings replaces all settings, so merge with existing
  try {
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
          DOCKER_REGISTRY_SERVER_URL: `https://${acrLoginServer}`,
        },
      },
    );
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new CliError(
      `Failed to set registry URL on App Service "${appServiceName}"`,
      'deploy-app-service',
      error.message ?? 'Unknown error',
    );
  }

  // Step 3: Restart to pick up new image
  try {
    await client.webApps.restart(resourceGroupName, appServiceName);
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new CliError(
      `Failed to restart App Service "${appServiceName}"`,
      'deploy-app-service',
      error.message ?? 'Unknown error',
    );
  }

  // Step 4: Verify running
  try {
    const app = await client.webApps.get(resourceGroupName, appServiceName);
    const state = app.state ?? 'Unknown';

    if (state !== 'Running') {
      throw new CliError(
        `App Service "${appServiceName}" failed to start. State: ${state}`,
        'deploy-app-service',
        `Check the Azure Portal for App Service "${appServiceName}"`,
      );
    }
  } catch (err: unknown) {
    if (err instanceof CliError) throw err;
    const error = err as { message?: string };
    throw new CliError(
      `Failed to verify App Service "${appServiceName}" status`,
      'deploy-app-service',
      error.message ?? 'Unknown error',
    );
  }
}
