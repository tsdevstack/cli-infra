/**
 * Ask App Service to read an app's Key Vault references again
 *
 * App Service keeps what it read from Key Vault. It reads the references
 * again every 24 hours, after a change to the app's settings, or when asked
 * through this call; a restart alone does not. A reference denied because
 * its role assignment had not applied yet stays denied until one of those.
 * Microsoft documents the call in "Use Key Vault references as app
 * settings" (Azure App Service); the App Service SDK has no method for it.
 */

import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import { AZURE_KEY_VAULT_REFERENCES_REFRESH_API_VERSION } from '../../../constants';

/**
 * @param options.credentials - Azure credentials of the environment
 * @param options.resourceGroupName - Resource group of the app
 * @param options.appServiceName - App Service name
 * @throws Error when Azure refuses the call
 */
export async function refreshKeyVaultReferences(options: {
  credentials: AzureCredentials;
  resourceGroupName: string;
  appServiceName: string;
}): Promise<void> {
  const { credentials, resourceGroupName, appServiceName } = options;
  const credential = createAzureCredential(buildRuntime(), credentials);
  const tokenResponse = await credential.getToken(
    'https://management.azure.com/.default',
  );
  if (!tokenResponse) {
    throw new Error('Could not get an Azure access token');
  }

  const url =
    `https://management.azure.com/subscriptions/${credentials.subscriptionId}` +
    `/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/sites/${appServiceName}` +
    `/config/configreferences/appsettings/refresh?api-version=${AZURE_KEY_VAULT_REFERENCES_REFRESH_API_VERSION}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenResponse.token}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    );
  }
}
