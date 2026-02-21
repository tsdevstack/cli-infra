/**
 * List Secrets by Prefix (AWS)
 *
 * Lists all secrets in AWS Secrets Manager that match a given prefix.
 * Used for discovering what secrets exist for a service.
 */

import {
  SecretsManagerClient,
  ListSecretsCommand,
} from '@aws-sdk/client-secrets-manager';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface ListSecretsByPrefixOptions {
  prefix: string;
  credentials: AWSCredentials;
}

export interface SecretInfo {
  name: string;
  arn: string;
}

export interface ListSecretsByPrefixResult {
  success: boolean;
  secrets: SecretInfo[];
  error?: string;
}

/**
 * List all secrets matching a prefix in AWS Secrets Manager
 */
export async function listSecretsByPrefix(
  options: ListSecretsByPrefixOptions,
): Promise<ListSecretsByPrefixResult> {
  const { prefix, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new SecretsManagerClient(clientConfig);

  try {
    const secrets: SecretInfo[] = [];
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
          if (secret.Name && secret.ARN) {
            secrets.push({
              name: secret.Name,
              arn: secret.ARN,
            });
          }
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return {
      success: true,
      secrets,
    };
  } catch (error) {
    return {
      success: false,
      secrets: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
