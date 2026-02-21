/**
 * Fetch all shared secrets from Secret Manager for build-time use
 *
 * Used by SPA deployment to get all secrets needed at build time.
 * SPAs can't fetch secrets at runtime (static files), so we fetch them
 * during deployment and pass to the build process.
 */

import { execSync } from 'node:child_process';
import { getContext } from '../../context';
import { fetchSecret } from '../credentials/fetch-secret';

interface CloudSecretsListOutput {
  provider: string;
  project: string;
  environment: string;
  total: number;
  shared: string[];
  services: Record<string, string[]>;
}

/**
 * Fetch all shared secrets from Secret Manager
 *
 * @param targetEnv - Environment (dev/staging/prod)
 * @returns Record<string, string> of all shared secrets
 */
export function fetchSharedSecrets(targetEnv: string): Record<string, string> {
  const { logger } = getContext();

  // Step 1: List all secrets to get the keys
  logger.info('Listing secrets from Secret Manager...');

  let listOutput: CloudSecretsListOutput;
  try {
    const result = execSync(
      `npx tsdevstack cloud-secrets:list --env ${targetEnv} --json`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    listOutput = JSON.parse(result.trim());
  } catch {
    throw new Error(
      `Failed to list secrets for environment "${targetEnv}". ` +
      `Make sure cloud:init has been run and secrets have been pushed.`
    );
  }

  const sharedKeys = listOutput.shared || [];
  logger.info(`Found ${sharedKeys.length} shared secrets`);

  if (sharedKeys.length === 0) {
    return {};
  }

  // Step 2: Fetch each secret value
  logger.info('Fetching secret values...');
  const secrets: Record<string, string> = {};

  for (const key of sharedKeys) {
    const value = fetchSecret(key, targetEnv);
    if (value !== null) {
      secrets[key] = value;
    } else {
      logger.warn(`Could not fetch secret: ${key}`);
    }
  }

  logger.success(`Fetched ${Object.keys(secrets).length} secrets`);
  return secrets;
}
