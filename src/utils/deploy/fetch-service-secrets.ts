/**
 * Fetch secrets for a specific service from Secret Manager
 *
 * Unlike fetchSharedSecrets which dumps ALL shared secrets,
 * this function only fetches the keys this service references
 * (from secret-map.json). This prevents secrets leaking into
 * client-side bundles for SPA builds.
 */

import { getContext } from '../../context';
import { getServiceSecretKeys } from './get-service-secret-keys';
import { fetchSecret } from '../credentials/fetch-secret';
import type { FrameworkConfig } from '@tsdevstack/cli/plugin';

/**
 * Fetch secret values for a specific service
 *
 * @param serviceName - Name of the service
 * @param config - Framework configuration
 * @param targetEnv - Target environment (dev/staging/prod)
 * @returns Record of key-value pairs for this service's secrets
 */
export function fetchServiceSecrets(
  serviceName: string,
  config: FrameworkConfig,
  targetEnv: string,
): Record<string, string> {
  const { logger } = getContext();

  const keys = getServiceSecretKeys(serviceName, config);
  logger.info(
    `Service "${serviceName}" references ${keys.length} secret ${keys.length === 1 ? 'key' : 'keys'}`,
  );

  if (keys.length === 0) {
    return {};
  }

  logger.info('Fetching secret values...');
  const secrets: Record<string, string> = {};

  for (const key of keys) {
    const value = fetchSecret(key, targetEnv);
    if (value !== null) {
      secrets[key] = value;
    } else {
      logger.warn(`Could not fetch secret: ${key}`);
    }
  }

  logger.success(
    `Fetched ${Object.keys(secrets).length} secrets for ${serviceName}`,
  );
  return secrets;
}
