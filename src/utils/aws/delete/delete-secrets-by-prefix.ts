/**
 * Delete Secrets by Prefix
 *
 * Deletes all secrets in AWS Secrets Manager that match a given prefix.
 * Idempotent: Returns success even if no secrets found.
 */

import {
  SecretsManagerClient,
  ListSecretsCommand,
  DeleteSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from 'tsdevstack/plugin';

export interface DeleteSecretsByPrefixOptions {
  prefix: string;
  credentials: AWSCredentials;
}

export interface DeleteSecretsByPrefixResult {
  success: boolean;
  totalDeleted: number;
  error?: string;
}

/**
 * Delete all secrets matching a prefix in AWS Secrets Manager
 *
 * Idempotent: Returns success even if no secrets found.
 */
export async function deleteSecretsByPrefix(
  options: DeleteSecretsByPrefixOptions,
): Promise<DeleteSecretsByPrefixResult> {
  const { prefix, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new SecretsManagerClient(clientConfig);

  try {
    const secretNames: string[] = [];
    let nextToken: string | undefined;

    // Paginate through all secrets
    do {
      const command = new ListSecretsCommand({
        Filters: [
          {
            Key: 'name',
            Values: [prefix],
          },
        ],
        NextToken: nextToken,
      });

      const response = await client.send(command);

      if (response.SecretList) {
        for (const secret of response.SecretList) {
          if (secret.Name) {
            secretNames.push(secret.Name);
          }
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    // Delete each secret
    let deletedCount = 0;
    for (const secretName of secretNames) {
      try {
        await client.send(
          new DeleteSecretCommand({
            SecretId: secretName,
            ForceDeleteWithoutRecovery: true,
          }),
        );
        deletedCount++;
      } catch (error) {
        // ResourceNotFoundException means already deleted - continue
        if (
          error instanceof Error &&
          error.name === 'ResourceNotFoundException'
        ) {
          continue;
        }
        // Other errors should be thrown
        throw error;
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
