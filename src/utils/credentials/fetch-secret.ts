/**
 * Fetch a single secret from Secret Manager via CLI
 */

import { execSync } from 'node:child_process';

/**
 * Fetch a single secret using the CLI command
 *
 * @param key - Secret key to fetch
 * @param env - Target environment
 * @param service - Optional service scope (defaults to 'shared')
 * @returns Secret value or null if not found
 */
export function fetchSecret(
  key: string,
  env: string,
  service?: string,
): string | null {
  try {
    let cmd = `npx tsdevstack cloud-secrets:get ${key} --env ${env}`;
    if (service) {
      cmd += ` --service ${service}`;
    }
    const result = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}
