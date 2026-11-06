/**
 * Deploy Container Image to Azure App Service
 *
 * Updates an App Service's container image and restarts it.
 * Uses the @azure/arm-appservice SDK.
 *
 * With sidecars, the app runs as site containers (Microsoft's "Configure
 * sidecars"): linuxFxVersion "sitecontainers", the main container and each
 * sidecar a site container, all pulled with the app's system-assigned
 * identity. The containers share the app settings and reach each other on
 * localhost. Without, the classic single container (DOCKER|<image>).
 */

import { WebSiteManagementClient } from '@azure/arm-appservice';
import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

interface DeployAppServiceParams {
  credentials: AzureCredentials;
  resourceGroupName: string;
  appServiceName: string;
  acrLoginServer: string;
  imageUri: string;
  /**
   * Extra app settings (container environment variables), merged on every
   * deploy: Terraform ignores app_settings changes after creation
   */
  appSettings?: Record<string, string>;
  /** Containers next to the main one (Kong's collector) */
  sidecars?: Array<{ name: string; imageUri: string }>;
  /** Main container's name and port, with sidecars */
  main?: { name: string; port: number };
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
    appSettings,
    sidecars,
    main,
  } = params;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new WebSiteManagementClient(
    credential,
    credentials.subscriptionId,
  );

  // Step 1: Update container image in site config
  try {
    if (sidecars && sidecars.length > 0) {
      if (!main) {
        throw new Error('the main container needs a name and a port');
      }
      const containers = [
        { name: main.name, image: imageUri, isMain: true, port: main.port },
        ...sidecars.map((sidecar) => ({
          name: sidecar.name,
          image: sidecar.imageUri,
          isMain: false,
          port: undefined,
        })),
      ];
      for (const container of containers) {
        await client.webApps.createOrUpdateSiteContainer(
          resourceGroupName,
          appServiceName,
          container.name,
          {
            image: container.image,
            isMain: container.isMain,
            ...(container.port !== undefined && {
              targetPort: String(container.port),
            }),
            authType: 'SystemIdentity',
            inheritAppSettingsAndConnectionStrings: true,
          },
        );
      }
      await client.webApps.updateConfiguration(
        resourceGroupName,
        appServiceName,
        { linuxFxVersion: 'sitecontainers' },
      );
    } else {
      await client.webApps.updateConfiguration(
        resourceGroupName,
        appServiceName,
        { linuxFxVersion: `DOCKER|${imageUri}` },
      );
    }
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new CliError(
      `Failed to set container image on App Service "${appServiceName}"`,
      'deploy-app-service',
      error.message ?? 'Unknown error',
    );
  }

  // Step 2: Ensure registry URL (and any extra settings) are set in app settings
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
          ...appSettings,
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
