/**
 * Make sure each database service's DATABASE_URL secret exists (GCP)
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';

export interface EnsureGcpDatabaseUrlSecretsOptions {
  projectName: string;
  credentials: GCPCredentials;
  /** Services with a database */
  serviceNames: readonly string[];
}

/**
 * db-init writes each service's DATABASE_URL (the app role) as a new version
 * and may not create secrets, so the CLI creates a missing one first, empty,
 * with the labels cloud-secrets:set gives its secrets. An existing secret is
 * left as it is.
 */
export async function ensureGcpDatabaseUrlSecrets(
  options: EnsureGcpDatabaseUrlSecretsOptions,
): Promise<void> {
  const { buildGCPClientOptions, buildSecretName } = getContext();
  const client = new SecretManagerServiceClient(
    buildGCPClientOptions(options.credentials),
  );
  const parent = `projects/${options.credentials.project_id}`;

  for (const serviceName of options.serviceNames) {
    const secretId = buildSecretName(
      options.projectName,
      serviceName,
      'DATABASE_URL',
    );
    try {
      await client.getSecret({ name: `${parent}/secrets/${secretId}` });
      continue;
    } catch (error) {
      // gRPC NOT_FOUND
      if ((error as { code?: number }).code !== 5) {
        throw error;
      }
    }
    await client.createSecret({
      parent,
      secretId,
      secret: {
        replication: { automatic: {} },
        labels: {
          'project-name': options.projectName,
          'managed-by': 'tsdevstack',
          'secret-type': 'user',
        },
      },
    });
  }
}
