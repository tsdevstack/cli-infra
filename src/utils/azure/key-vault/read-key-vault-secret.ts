/**
 * Read one secret from an Azure Key Vault
 */

import { SecretClient } from '@azure/keyvault-secrets';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';

export interface ReadKeyVaultSecretOptions {
  credentials: AzureCredentials;
  vaultName: string;
  /** The secret's name in Key Vault (hyphens, no underscores) */
  secretName: string;
}

/**
 * @returns The secret's current value, or null when it doesn't exist
 * @throws The SDK's error for anything else (no access, no vault)
 */
export async function readKeyVaultSecret(
  options: ReadKeyVaultSecretOptions,
): Promise<string | null> {
  const client = new SecretClient(
    `https://${options.vaultName}.vault.azure.net`,
    createAzureCredential(buildRuntime(), options.credentials),
  );
  try {
    const secret = await client.getSecret(options.secretName);
    return secret.value ?? null;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return null;
    }
    throw error;
  }
}
