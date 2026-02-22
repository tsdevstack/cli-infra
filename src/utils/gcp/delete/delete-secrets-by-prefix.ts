/**
 * Delete Secrets by Prefix
 *
 * Uses @google-cloud/secret-manager to delete all secrets matching a prefix.
 * Idempotent: NOT_FOUND for individual secrets is treated as success.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { GCPCredentials } from 'tsdevstack/plugin';
import { getContext } from '../../../context';

export interface DeleteSecretsByPrefixOptions {
  projectId: string;
  prefix: string;
  credentials: GCPCredentials;
}

export interface DeletedSecretInfo {
  name: string;
  deleted: boolean;
  alreadyGone?: boolean;
  error?: string;
}

export interface DeleteSecretsByPrefixResult {
  success: boolean;
  secrets: DeletedSecretInfo[];
  totalDeleted: number;
  totalAlreadyGone: number;
  totalFailed: number;
  error?: string;
}

/**
 * Delete all secrets matching a prefix
 *
 * Idempotent: Returns success even if secrets already deleted.
 *
 * @param options - Project ID, prefix pattern, and credentials
 * @returns Result with details of each deleted secret
 */
export async function deleteSecretsByPrefix(
  options: DeleteSecretsByPrefixOptions,
): Promise<DeleteSecretsByPrefixResult> {
  const { buildGCPClientOptions } = getContext();

  const client = new SecretManagerServiceClient(
    buildGCPClientOptions(options.credentials),
  );

  const deletedSecrets: DeletedSecretInfo[] = [];
  let totalDeleted = 0;
  let totalAlreadyGone = 0;
  let totalFailed = 0;

  try {
    // List all secrets
    const [secrets] = await client.listSecrets({
      parent: `projects/${options.projectId}`,
    });

    // Find matching secrets
    const matchingSecrets = secrets.filter((secret) => {
      if (!secret.name) return false;
      const secretId = secret.name.split('/').pop();
      return secretId && secretId.startsWith(options.prefix);
    });

    // Delete each matching secret
    for (const secret of matchingSecrets) {
      if (!secret.name) continue;

      const secretId = secret.name.split('/').pop() ?? 'unknown';

      try {
        await client.deleteSecret({ name: secret.name });
        deletedSecrets.push({ name: secretId, deleted: true });
        totalDeleted++;
      } catch (error: unknown) {
        // NOT_FOUND means already deleted - this is success
        if (error instanceof Error && error.message.includes('NOT_FOUND')) {
          deletedSecrets.push({
            name: secretId,
            deleted: false,
            alreadyGone: true,
          });
          totalAlreadyGone++;
        } else {
          deletedSecrets.push({
            name: secretId,
            deleted: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          totalFailed++;
        }
      }
    }

    return {
      success: totalFailed === 0,
      secrets: deletedSecrets,
      totalDeleted,
      totalAlreadyGone,
      totalFailed,
    };
  } catch (error: unknown) {
    return {
      success: false,
      secrets: deletedSecrets,
      totalDeleted,
      totalAlreadyGone,
      totalFailed,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
