/**
 * Remove one identity's read access to individual Key Vault secrets
 */

import { ResourceManagementClient } from '@azure/arm-resources';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { buildRoleAssignmentName } from './build-role-assignment-name';
import {
  AZURE_KEY_VAULT_SECRETS_USER_ROLE_ID,
  AZURE_ROLE_ASSIGNMENTS_API_VERSION,
} from '../../../constants';

/**
 * Delete the role assignments grantKeyVaultSecretRead made, found by the
 * same names. Azure keeps an assignment after its identity is deleted (it
 * shows as an unknown identity), so remove them while the identity exists.
 * An assignment that is already gone counts as removed.
 *
 * @param options.credentials - Azure credentials of the environment
 * @param options.resourceGroupName - Resource group of the vault
 * @param options.keyVaultName - Vault name
 * @param options.secretNames - Secret names as stored in the vault (hyphens)
 * @param options.principalId - Object ID of the identity
 */
export async function revokeKeyVaultSecretRead(options: {
  credentials: AzureCredentials;
  resourceGroupName: string;
  keyVaultName: string;
  secretNames: readonly string[];
  principalId: string;
}): Promise<void> {
  const { CliError } = getContext();
  const {
    credentials,
    resourceGroupName,
    keyVaultName,
    secretNames,
    principalId,
  } = options;

  const client = new ResourceManagementClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );
  const vaultId = `/subscriptions/${credentials.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.KeyVault/vaults/${keyVaultName}`;

  for (const secretName of secretNames) {
    const scope = `${vaultId}/secrets/${secretName}`;
    const name = buildRoleAssignmentName(
      scope,
      principalId,
      AZURE_KEY_VAULT_SECRETS_USER_ROLE_ID,
    );
    try {
      await client.resources.deleteById(
        `${scope}/providers/Microsoft.Authorization/roleAssignments/${name}`,
        AZURE_ROLE_ASSIGNMENTS_API_VERSION,
      );
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 404) {
        continue;
      }
      throw new CliError(
        `Failed to remove read access to ${secretName} in Key Vault ${keyVaultName}: ${error instanceof Error ? error.message : String(error)}`,
        'Key Vault access',
        'Remove it in the portal: Key Vault > Secrets > the secret > Access control (IAM)',
      );
    }
  }
}
