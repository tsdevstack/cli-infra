/**
 * Get Redis Configuration
 *
 * Looks up redis in infrastructure config and merges with defaults.
 */

import type {
  RedisOverride,
  ResolvedRedisConfig,
  InfraProvider,
} from './types';
import { mergeRedisWithDefaults } from './merge-redis-with-defaults';

/**
 * Get resolved redis configuration for an environment
 *
 * @param config - Infrastructure config (or null for all defaults)
 * @param environment - Environment name
 * @param provider - Cloud provider ('gcp' or 'aws')
 * @returns Fully resolved redis configuration
 */
export function getRedisConfig(
  config: { [env: string]: unknown } | null,
  environment: string,
  provider: InfraProvider,
): ResolvedRedisConfig {
  // No config file - use all defaults
  if (!config) {
    return mergeRedisWithDefaults(undefined, provider);
  }

  // Get environment overrides
  const envConfig = config[environment];
  if (!envConfig || typeof envConfig !== 'object') {
    return mergeRedisWithDefaults(undefined, provider);
  }

  // Get redis override
  const redisOverride = (envConfig as { redis?: RedisOverride }).redis;

  return mergeRedisWithDefaults(redisOverride, provider);
}
