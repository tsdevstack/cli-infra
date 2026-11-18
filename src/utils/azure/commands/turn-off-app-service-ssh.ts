/**
 * Turn off SSH into an App Service app's containers
 */

import { ResourceManagementClient } from '@azure/arm-resources';
import type { TokenCredential } from '@azure/identity';
import { AZURE_APP_SERVICE_SSH_API_VERSION } from '../../../constants';

/**
 * Kudu, the app's deploy and log stream site, is reachable from the
 * internet with an Azure sign-in (publish rights on the app). Kudu also
 * opens a shell in the app's containers; the framework doesn't use it, so
 * it is off (Microsoft's "Control SSH access"). A PATCH of `sshEnabled`
 * alone, since azurerm can't set it.
 *
 * @param credential - Azure credential
 * @param subscriptionId - The app's subscription
 * @param resourceGroupName - The app's resource group
 * @param appServiceName - The app
 * @throws The SDK's error when Azure refuses the update
 */
export async function turnOffAppServiceSsh(
  credential: TokenCredential,
  subscriptionId: string,
  resourceGroupName: string,
  appServiceName: string,
): Promise<void> {
  const client = new ResourceManagementClient(credential, subscriptionId);
  await client.resources.updateById(
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/sites/${appServiceName}`,
    AZURE_APP_SERVICE_SSH_API_VERSION,
    { properties: { sshEnabled: false } },
  );
}
