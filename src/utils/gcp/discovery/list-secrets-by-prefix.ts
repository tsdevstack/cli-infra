/**
 * List secrets by prefix
 *
 * Uses @google-cloud/secret-manager to list secrets matching a prefix.
 * Used to discover service-scoped secrets for deletion.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { GCPCredentials } from 'tsdevstack/plugin';
import { getContext } from '../../../context';

export interface ListSecretsByPrefixOptions {
  projectId: string;
  prefix: string;
  credentials: GCPCredentials;
}

export interface SecretInfo {
  name: string;
  fullName: string;
}

export interface ListSecretsByPrefixResult {
  success: boolean;
  secrets: SecretInfo[];
  error?: string;
}

/**
 * List all secrets matching a prefix
 *
 * @param options - Project ID, prefix pattern, and credentials
 * @returns List of matching secret names
 */
export async function listSecretsByPrefix(
  options: ListSecretsByPrefixOptions,
): Promise<ListSecretsByPrefixResult> {
  const { buildGCPClientOptions } = getContext();

  const client = new SecretManagerServiceClient(
    buildGCPClientOptions(options.credentials),
  );

  try {
    const [secrets] = await client.listSecrets({
      parent: `projects/${options.projectId}`,
    });

    const matchingSecrets: SecretInfo[] = [];
    for (const secret of secrets) {
      if (secret.name) {
        // Extract secret ID from full name (projects/xxx/secrets/yyy)
        const secretId = secret.name.split('/').pop();
        if (secretId && secretId.startsWith(options.prefix)) {
          matchingSecrets.push({
            name: secretId,
            fullName: secret.name,
          });
        }
      }
    }

    return {
      success: true,
      secrets: matchingSecrets,
    };
  } catch (error: unknown) {
    return {
      success: false,
      secrets: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
