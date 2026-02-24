/**
 * Delete Shared Secrets for a Service (Azure)
 *
 * When a service is removed, we need to clean up shared secrets that belong to it:
 * - DB-{PREFIX}-PASSWORD (if hasDatabase) - PREFIX strips -service suffix
 * - DB-{PREFIX}-USERNAME (if hasDatabase) - PREFIX strips -service suffix
 * - {FULL_NAME}-API-KEY (for NestJS services) - FULL_NAME keeps full name
 * - {FULL_NAME}-URL (for backend services) - FULL_NAME keeps full name
 *
 * These are stored as {project}-shared-{KEY} in Key Vault.
 * Key Vault uses hyphens instead of underscores (auto-transformed).
 *
 * Idempotent: 404 is treated as success.
 */

import { SecretClient } from '@azure/keyvault-secrets';
import { createAzureCredential, toEnvVarPrefix } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { toScreamingSnakeCase } from '../../string/to-screaming-snake-case';

export interface DeleteSharedSecretsOptions {
  projectName: string;
  serviceName: string;
  hasDatabase: boolean;
  credentials: AzureCredentials;
  vaultName: string;
}

export interface DeleteSharedSecretsResult {
  success: boolean;
  deleted: string[];
  alreadyGone: string[];
  failed: string[];
  error?: string;
}

/**
 * Convert an underscore-based key to Azure Key Vault format (hyphens)
 */
function toKeyVaultName(key: string): string {
  return key.replace(/_/g, '-');
}

/**
 * Delete shared secrets that belong to a specific service
 *
 * Idempotent: Returns success even if secrets already deleted.
 */
export async function deleteSharedSecretsForService(
  options: DeleteSharedSecretsOptions,
): Promise<DeleteSharedSecretsResult> {
  const { logger } = getContext();
  const runtime = buildRuntime();

  const credential = createAzureCredential(runtime, options.credentials);

  const vaultUrl = `https://${options.vaultName}.vault.azure.net`;
  const client = new SecretClient(vaultUrl, credential);

  // For URL/API_KEY: use full service name (test-service -> TEST_SERVICE)
  const fullNameUpper = toScreamingSnakeCase(options.serviceName);
  // For DB secrets: strip -service suffix (test-service -> TEST)
  const dbPrefix = toEnvVarPrefix(options.serviceName);
  const sharedPrefix = `${options.projectName}-shared`;

  // Build list of shared secrets to delete for this service
  // Key Vault format uses hyphens instead of underscores
  const secretsToDelete: string[] = [];

  // Service URL and API key
  secretsToDelete.push(toKeyVaultName(`${sharedPrefix}-${fullNameUpper}_URL`));
  secretsToDelete.push(
    toKeyVaultName(`${sharedPrefix}-${fullNameUpper}_API_KEY`),
  );

  // Database secrets (if service has database)
  if (options.hasDatabase) {
    secretsToDelete.push(
      toKeyVaultName(`${sharedPrefix}-DB_${dbPrefix}_PASSWORD`),
    );
    secretsToDelete.push(
      toKeyVaultName(`${sharedPrefix}-DB_${dbPrefix}_USERNAME`),
    );
  }

  const deleted: string[] = [];
  const alreadyGone: string[] = [];
  const failed: string[] = [];

  for (const secretName of secretsToDelete) {
    try {
      await client.beginDeleteSecret(secretName);
      deleted.push(secretName);
    } catch (err: unknown) {
      const error = err as { statusCode?: number; message?: string };
      // 404 means already deleted - this is success
      if (error.statusCode === 404) {
        alreadyGone.push(secretName);
      } else {
        failed.push(secretName);
        logger.warn(
          `  Failed to delete ${secretName}: ${error.message || 'Unknown'}`,
        );
      }
    }
  }

  return {
    success: failed.length === 0,
    deleted,
    alreadyGone,
    failed,
    error:
      failed.length > 0
        ? `Failed to delete ${failed.length} secret(s)`
        : undefined,
  };
}
