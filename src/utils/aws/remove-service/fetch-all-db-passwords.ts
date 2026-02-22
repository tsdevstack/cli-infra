/**
 * Fetch All Database Passwords (AWS)
 *
 * Pre-fetch all database passwords from Secrets Manager before deletion.
 * Terraform needs these for refresh, but secrets will be deleted at the end.
 */

import {
  SecretsManagerClient,
  ListSecretsCommand,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from 'tsdevstack/plugin';

export interface FetchAllDbPasswordsOptions {
  projectName: string;
  credentials: AWSCredentials;
}

/**
 * Fetch all DB passwords for Terraform state sync
 *
 * Returns mapping of service name to password
 */
export async function fetchAllDbPasswords(
  options: FetchAllDbPasswordsOptions,
): Promise<Record<string, string>> {
  const { projectName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new SecretsManagerClient(clientConfig);

  const passwords: Record<string, string> = {};

  try {
    // List all secrets
    const listResponse = await client.send(new ListSecretsCommand({}));

    // Filter for DATABASE_URL secrets
    const dbSecrets =
      listResponse.SecretList?.filter(
        (s) =>
          s.Name?.startsWith(`${projectName}-`) &&
          s.Name?.includes('DATABASE_URL'),
      ) || [];

    // Fetch each password
    for (const secret of dbSecrets) {
      if (!secret.Name) continue;

      // Extract service name from secret name
      // Format: {project}-{service}-DATABASE_URL
      const serviceName = secret.Name.replace(`${projectName}-`, '').replace(
        '-DATABASE_URL',
        '',
      );

      try {
        const valueResponse = await client.send(
          new GetSecretValueCommand({ SecretId: secret.Name }),
        );

        if (valueResponse.SecretString) {
          // Extract password from DATABASE_URL
          const dbUrl = valueResponse.SecretString;
          const match = dbUrl.match(/:\/\/[^:]+:([^@]+)@/);
          if (match) {
            passwords[serviceName] = match[1];
          }
        }
      } catch {
        // Skip if can't fetch
        continue;
      }
    }

    return passwords;
  } catch {
    return passwords;
  }
}
