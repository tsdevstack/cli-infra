/**
 * Write one secret to an Azure Key Vault when its value changes
 */

import { SecretClient } from '@azure/keyvault-secrets';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';

export interface WriteKeyVaultSecretOptions {
  credentials: AzureCredentials;
  vaultName: string;
  /** The secret's name in Key Vault (hyphens, no underscores) */
  secretName: string;
  value: string;
}

/**
 * Sets the secret unless it already holds the value (no new version on
 * every deploy). A deleted secret that still holds the name (soft delete)
 * is recovered and gets the value.
 *
 * @returns Whether it wrote
 */
export async function writeKeyVaultSecret(
  options: WriteKeyVaultSecretOptions,
): Promise<boolean> {
  const client = new SecretClient(
    `https://${options.vaultName}.vault.azure.net`,
    createAzureCredential(buildRuntime(), options.credentials),
  );
  try {
    const current = await client.getSecret(options.secretName);
    if (current.value === options.value) {
      return false;
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) {
      throw error;
    }
  }
  const { setKeyVaultSecret } = getContext();
  await setKeyVaultSecret(client, options.secretName, options.value);
  return true;
}
