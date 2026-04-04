/**
 * Set App Settings on Azure App Service
 *
 * Merges the provided settings into existing app settings.
 * Uses the @azure/arm-appservice SDK.
 * Retries on transient failures (App Service may not be fully provisioned).
 */

import { WebSiteManagementClient } from '@azure/arm-appservice';
import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

export const MAX_RETRIES = 5;
export const RETRY_DELAY_MS = 30000;

export async function setAppServiceSettings(
  credentials: AzureCredentials,
  resourceGroupName: string,
  appServiceName: string,
  settings: Record<string, string>,
  retryDelayMs: number = RETRY_DELAY_MS,
): Promise<void> {
  const { logger, CliError } = getContext();

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const client = new WebSiteManagementClient(
    credential,
    credentials.subscriptionId,
  );

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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

      return;
    } catch (err: unknown) {
      const error = err as { message?: string };
      const message = error.message ?? 'Unknown error';

      if (attempt < MAX_RETRIES) {
        logger.warn(
          `  App Service settings failed (attempt ${attempt}/${MAX_RETRIES}): ${message}`,
        );
        logger.info(`  Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        throw new CliError(
          `Failed to set app settings on App Service "${appServiceName}"`,
          'set-app-service-settings',
          message,
        );
      }
    }
  }
}
