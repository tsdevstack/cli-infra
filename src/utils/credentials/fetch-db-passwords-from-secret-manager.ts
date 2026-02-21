/**
 * Fetch database passwords from Secret Manager (for local development)
 *
 * Calls `npx tsdevstack cloud-secrets:get` to fetch DB passwords.
 */

import { getContext } from '../../context';
import { toEnvVarPrefix } from '@tsdevstack/infra-core';
import { fetchSecret } from './fetch-secret';

interface ServiceDatabaseInfo {
  name: string;
  hasDatabase: boolean;
}

/**
 * Fetch database passwords from Secret Manager
 *
 * @param env - Target environment (dev, staging, prod)
 * @param servicesWithDb - Services that need database passwords
 * @returns Record of service name to password
 * @throws CliError if any required password is missing
 */
export async function fetchDbPasswordsFromSecretManager(
  env: string,
  servicesWithDb: ServiceDatabaseInfo[],
): Promise<Record<string, string>> {
  const { CliError, logger } = getContext();

  const passwords: Record<string, string> = {};
  const missing: string[] = [];

  const services = servicesWithDb.filter((s) => s.hasDatabase);

  for (const service of services) {
    const suffix = toEnvVarPrefix(service.name);
    const secretKey = `DB_${suffix}_PASSWORD`;

    logger.loading(`Fetching ${secretKey} from Secret Manager...`);
    const password = fetchSecret(secretKey, env);

    if (!password) {
      missing.push(secretKey);
    } else {
      passwords[service.name] = password;
    }
  }

  if (missing.length > 0) {
    throw new CliError(
      `Missing database passwords in Secret Manager: ${missing.join(', ')}`,
      'infra:deploy',
      'Push these secrets first:\n  npx tsdevstack cloud-secrets:push --env ' +
        env,
    );
  }

  return passwords;
}
