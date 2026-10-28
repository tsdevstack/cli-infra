/**
 * Let one identity read individual Key Vault secrets
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
 * Grant Key Vault Secrets User on each named secret, not on the vault: the
 * identity can read these secrets and nothing else. Safe to repeat: each
 * assignment's name follows from what it grants. A role assignment needs an
 * existing scope, so the secrets must already be in the vault.
 *
 * @param options.credentials - Azure credentials of the environment
 * @param options.resourceGroupName - Resource group of the vault
 * @param options.keyVaultName - Vault name
 * @param options.secretNames - Secret names as stored in the vault (hyphens)
 * @param options.principalId - Object ID of the identity
 */
export async function grantKeyVaultSecretRead(options: {
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
  const roleDefinitionId = `/subscriptions/${credentials.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${AZURE_KEY_VAULT_SECRETS_USER_ROLE_ID}`;

  for (const secretName of secretNames) {
    const scope = `${vaultId}/secrets/${secretName}`;
    const name = buildRoleAssignmentName(
      scope,
      principalId,
      AZURE_KEY_VAULT_SECRETS_USER_ROLE_ID,
    );
    try {
      await client.resources.createOrUpdateById(
        `${scope}/providers/Microsoft.Authorization/roleAssignments/${name}`,
        AZURE_ROLE_ASSIGNMENTS_API_VERSION,
        {
          properties: {
            roleDefinitionId,
            principalId,
            principalType: 'ServicePrincipal',
          },
        },
      );
    } catch (error) {
      // The same grant under another name (made by hand): nothing to add
      if ((error as { code?: string })?.code === 'RoleAssignmentExists') {
        continue;
      }
      throw new CliError(
        `Failed to grant read access to ${secretName} in Key Vault ${keyVaultName}: ${error instanceof Error ? error.message : String(error)}`,
        'Key Vault access',
        'The secret must exist in the vault, and your credentials need permission to create role assignments on the resource group',
      );
    }
  }
}
