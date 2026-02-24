/**
 * Delete Shared Secrets for a Service
 *
 * When a service is removed, we need to clean up not just service-scoped secrets
 * (tsdevstack-auth-service-*) but also shared secrets that belong to that service:
 * - DB_{PREFIX}_PASSWORD (if hasDatabase) - PREFIX strips -service suffix
 * - DB_{PREFIX}_USERNAME (if hasDatabase) - PREFIX strips -service suffix
 * - {FULL_NAME}_API_KEY (for NestJS services) - FULL_NAME keeps full name
 * - {FULL_NAME}_URL (for backend services) - FULL_NAME keeps full name
 *
 * These are stored as tsdevstack-shared-{KEY} in Secret Manager.
 *
 * Note: Frontend services (Next.js, SPA) don't have _URL or _API_KEY secrets.
 * The deletion is idempotent - NOT_FOUND is treated as success.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { toEnvVarPrefix } from '@tsdevstack/infra-core';
import { toScreamingSnakeCase } from '../../string/to-screaming-snake-case';

export interface DeleteSharedSecretsOptions {
  projectId: string;
  projectName: string;
  serviceName: string;
  hasDatabase: boolean;
  credentials: GCPCredentials;
}

export interface DeleteSharedSecretsResult {
  success: boolean;
  deleted: string[];
  alreadyGone: string[];
  failed: string[];
  error?: string;
}

/**
 * Delete shared secrets that belong to a specific service
 *
 * Idempotent: Returns success even if secrets already deleted.
 */
export async function deleteSharedSecretsForService(
  options: DeleteSharedSecretsOptions,
): Promise<DeleteSharedSecretsResult> {
  const { buildGCPClientOptions, logger } = getContext();

  const client = new SecretManagerServiceClient(
    buildGCPClientOptions(options.credentials),
  );

  // For URL/API_KEY: use full service name (test-service -> TEST_SERVICE)
  const fullNameUpper = toScreamingSnakeCase(options.serviceName);
  // For DB secrets: strip -service suffix (test-service -> TEST)
  const dbPrefix = toEnvVarPrefix(options.serviceName);
  const sharedPrefix = `${options.projectName}-shared`;

  // Build list of shared secrets to delete for this service
  const secretsToDelete: string[] = [];

  // Service URL and API key (uses full name)
  // Note: These might not exist for frontend services - that's ok, NOT_FOUND is success
  secretsToDelete.push(`${sharedPrefix}-${fullNameUpper}_URL`);
  secretsToDelete.push(`${sharedPrefix}-${fullNameUpper}_API_KEY`);

  // Database secrets (if service has database) - uses prefix without -service
  if (options.hasDatabase) {
    secretsToDelete.push(`${sharedPrefix}-DB_${dbPrefix}_PASSWORD`);
    secretsToDelete.push(`${sharedPrefix}-DB_${dbPrefix}_USERNAME`);
  }

  const deleted: string[] = [];
  const alreadyGone: string[] = [];
  const failed: string[] = [];

  for (const secretId of secretsToDelete) {
    const secretName = `projects/${options.projectId}/secrets/${secretId}`;

    try {
      await client.deleteSecret({ name: secretName });
      deleted.push(secretId);
    } catch (error: unknown) {
      // NOT_FOUND means already deleted - this is success
      if (error instanceof Error && error.message.includes('NOT_FOUND')) {
        alreadyGone.push(secretId);
      } else {
        failed.push(secretId);
        logger.warn(
          `  Failed to delete ${secretId}: ${error instanceof Error ? error.message : 'Unknown'}`,
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
