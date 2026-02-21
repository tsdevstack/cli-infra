/**
 * Get AWS Redis Configuration
 *
 * Extracts and merges AWS-specific Redis config from infrastructure.json
 */

import type { AWSInfraConfig } from '@tsdevstack/infra-core';

/**
 * Get AWS-specific Redis configuration from infrastructure config
 */
export function getAWSRedisConfig(
  infraConfig: { [env: string]: unknown } | null,
  environment: string,
): AWSInfraConfig['redis'] {
  const defaults = {
    tier: 'cache.t3.micro',
    highAvailability: false,
  };

  if (!infraConfig) return defaults;

  const envConfig = infraConfig[environment];
  if (!envConfig || typeof envConfig !== 'object') return defaults;

  const redisOverride = (envConfig as { redis?: Record<string, unknown> })
    .redis;
  if (!redisOverride) return defaults;

  return {
    tier: (redisOverride.tier as string) ?? defaults.tier,
    highAvailability:
      (redisOverride.highAvailability as boolean) ?? defaults.highAvailability,
  };
}
