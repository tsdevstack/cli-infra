/**
 * Fetch All Database Passwords
 *
 * Fetch all database passwords for services discovered in cloud.
 * Must be called BEFORE any deletions so secrets are still available.
 */

import { getContext } from '../../../context';
import { discoverDeployedServices } from '../discovery';
import { fetchSecret } from '../../credentials/fetch-secret';
import { toEnvVarPrefix } from '@tsdevstack/infra-core';
import { toTfVarSuffix } from '../../terraform';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface FetchAllDbPasswordsOptions {
  projectName: string;
  projectId: string;
  region: string;
  sqlInstanceName: string;
  credentials: GCPCredentials;
  targetEnv: string;
}

/**
 * Fetch all database passwords for services discovered in cloud
 * Must be called BEFORE any deletions so secrets are still available
 *
 * @returns Record of TF var suffix to password (e.g., { auth_service: 'password123' })
 */
export async function fetchAllDbPasswords(
  options: FetchAllDbPasswordsOptions,
): Promise<Record<string, string>> {
  const { logger } = getContext();
  const passwords: Record<string, string> = {};

  // Discover all deployed services
  const discoveryResult = await discoverDeployedServices({
    projectName: options.projectName,
    projectId: options.projectId,
    region: options.region,
    sqlInstanceName: options.sqlInstanceName,
    credentials: options.credentials,
  });

  if (!discoveryResult.success) {
    return passwords;
  }

  // Fetch passwords for all services with databases
  const servicesWithDb = discoveryResult.services.filter(
    (s) => s.resources.hasDatabase,
  );

  for (const service of servicesWithDb) {
    try {
      const envVarPrefix = toEnvVarPrefix(service.name);
      const secretKey = `DB_${envVarPrefix}_PASSWORD`;
      const password = fetchSecret(secretKey, options.targetEnv);

      if (password) {
        // Store with TF var suffix as key
        const tfVarSuffix = toTfVarSuffix(service.name);
        passwords[tfVarSuffix] = password;
      }
    } catch {
      logger.warn(`  Could not fetch password for ${service.name}`);
    }
  }

  return passwords;
}
