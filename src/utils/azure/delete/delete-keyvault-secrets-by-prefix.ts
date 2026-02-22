/**
 * Delete Key Vault Secrets by Prefix
 *
 * Deletes all secrets in Azure Key Vault that match a given prefix.
 * Idempotent: Returns success even if no secrets found.
 *
 * Note: Key Vault uses hyphens instead of underscores in secret names.
 * The framework handles this transform automatically.
 */

import { SecretClient } from '@azure/keyvault-secrets';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from 'tsdevstack/plugin';
import { buildRuntime } from '../../build-runtime';

export interface DeleteKeyVaultSecretsByPrefixOptions {
  credentials: AzureCredentials;
  vaultName: string;
  prefix: string;
}

export interface DeleteKeyVaultSecretsByPrefixResult {
  success: boolean;
  totalDeleted: number;
  error?: string;
}

/**
 * Delete all Key Vault secrets matching a prefix
 *
 * Idempotent: Returns success even if no secrets found.
 */
export async function deleteKeyVaultSecretsByPrefix(
  options: DeleteKeyVaultSecretsByPrefixOptions,
): Promise<DeleteKeyVaultSecretsByPrefixResult> {
  const { credentials, vaultName, prefix } = options;
  const runtime = buildRuntime();

  const credential = createAzureCredential(runtime, credentials);

  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(vaultUrl, credential);

  try {
    // List all secrets and filter by prefix
    const secretNames: string[] = [];
    for await (const secret of client.listPropertiesOfSecrets()) {
      if (secret.name.startsWith(prefix)) {
        secretNames.push(secret.name);
      }
    }

    // Delete each matching secret
    let deletedCount = 0;
    for (const secretName of secretNames) {
      try {
        await client.beginDeleteSecret(secretName);
        deletedCount++;
      } catch (err: unknown) {
        const error = err as { statusCode?: number };
        // 404 means already deleted - continue
        if (error.statusCode === 404) {
          continue;
        }
        throw err;
      }
    }

    return {
      success: true,
      totalDeleted: deletedCount,
    };
  } catch (error) {
    return {
      success: false,
      totalDeleted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
