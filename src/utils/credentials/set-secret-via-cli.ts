/**
 * Set a secret in Secret Manager via CLI
 */

import { spawnSync } from 'node:child_process';

/**
 * Set a secret in Secret Manager via CLI
 * Uses spawnSync with args array to avoid shell injection
 *
 * @param key - Secret key
 * @param value - Secret value
 * @param env - Target environment
 * @param service - Optional service scope (defaults to 'shared')
 */
export function setSecretViaCli(
  key: string,
  value: string,
  env: string,
  service?: string,
): void {
  const args = ['tsdevstack', 'cloud-secrets:set', key, '--value', value, '--env', env, '--overwrite'];

  if (service) {
    args.push('--service', service);
  }

  const result = spawnSync('npx', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to set secret');
  }
}