/**
 * Merge Redis Override with Defaults
 *
 * Merges partial redis override with built-in defaults.
 */

import {
  REDIS_DEFAULTS_GCP,
  REDIS_DEFAULTS_AWS,
  REDIS_DEFAULTS_AZURE,
} from '../../constants';
import type {
  RedisOverride,
  ResolvedRedisConfig,
  InfraProvider,
} from './types';

/**
 * Merge redis override with defaults
 *
 * @param override - Partial redis override from infrastructure.json (or undefined)
 * @param provider - Cloud provider ('gcp', 'aws', or 'azure')
 * @returns Fully resolved redis configuration
 */
export function mergeRedisWithDefaults(
  override: RedisOverride | undefined,
  provider: InfraProvider,
): ResolvedRedisConfig {
  const defaults =
    provider === 'aws'
      ? REDIS_DEFAULTS_AWS
      : provider === 'azure'
        ? REDIS_DEFAULTS_AZURE
        : REDIS_DEFAULTS_GCP;

  return {
    tier: override?.tier ?? defaults.tier,
    memoryGb: override?.memoryGb ?? defaults.memoryGb,
  };
}
