/**
 * List Key Vault Secrets by Prefix
 *
 * Lists all secrets in Azure Key Vault that match a given prefix.
 * Used for service-scoped secret discovery.
 */

import { SecretClient } from '@azure/keyvault-secrets';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

export interface ListKeyVaultSecretsByPrefixOptions {
  credentials: AzureCredentials;
  vaultName: string;
  prefix: string;
}

export interface ListKeyVaultSecretsByPrefixResult {
  success: boolean;
  secrets: string[];
  error?: string;
}

/**
 * List all Key Vault secrets matching a prefix
 */
export async function listKeyVaultSecretsByPrefix(
  options: ListKeyVaultSecretsByPrefixOptions,
): Promise<ListKeyVaultSecretsByPrefixResult> {
  const { credentials, vaultName, prefix } = options;

  const runtime = buildRuntime();
  const credential = createAzureCredential(runtime, credentials);

  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(vaultUrl, credential);

  try {
    const secrets: string[] = [];

    for await (const secret of client.listPropertiesOfSecrets()) {
      if (secret.name.startsWith(prefix)) {
        secrets.push(secret.name);
      }
    }

    return { success: true, secrets };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      secrets: [],
      error: error.message || 'Unknown error listing Key Vault secrets',
    };
  }
}
