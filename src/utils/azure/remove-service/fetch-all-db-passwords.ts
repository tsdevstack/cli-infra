/**
 * Fetch All DB Passwords (Azure)
 *
 * Pre-fetch all database passwords from Key Vault before deleting resources.
 * Terraform needs these passwords during state sync, but they'll be deleted
 * as part of the removal process.
 */

import { SecretClient } from '@azure/keyvault-secrets';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';

export interface FetchAllDbPasswordsOptions {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

/**
 * Fetch all DB passwords from Key Vault
 *
 * Returns a map of service name → password value.
 */
export async function fetchAllDbPasswords(
  options: FetchAllDbPasswordsOptions,
): Promise<Record<string, string>> {
  const { logger, buildKeyVaultName } = getContext();
  const { projectName, targetEnv, credentials } = options;
  const runtime = buildRuntime();

  // Database passwords are shared secrets: the shared vault
  const vaultName = buildKeyVaultName(projectName, targetEnv);

  const credential = createAzureCredential(runtime, credentials);

  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(vaultUrl, credential);

  const passwords: Record<string, string> = {};
  const sharedPrefix = `${projectName}-shared-DB-`;

  try {
    // List all DB password secrets
    for await (const secretProp of client.listPropertiesOfSecrets()) {
      // Key Vault uses hyphens: tsdevstack-shared-DB-AUTH-PASSWORD
      if (
        secretProp.name.startsWith(sharedPrefix) &&
        secretProp.name.endsWith('-PASSWORD')
      ) {
        try {
          const secret = await client.getSecret(secretProp.name);
          if (secret.value) {
            // Extract service prefix from secret name
            // tsdevstack-shared-DB-AUTH-PASSWORD → auth
            const prefixPart = secretProp.name
              .slice(sharedPrefix.length)
              .replace(/-PASSWORD$/, '')
              .toLowerCase()
              .replace(/-/g, '_');

            // Convert prefix to service name: AUTH → auth-service
            const serviceName = `${prefixPart.replace(/_/g, '-')}-service`;
            passwords[serviceName] = secret.value;
          }
        } catch {
          logger.warn(`  Could not read secret: ${secretProp.name}`);
        }
      }
    }
  } catch {
    logger.warn('  Could not list Key Vault secrets for DB passwords');
  }

  return passwords;
}
