/**
 * Get Kong Configuration
 *
 * Looks up Kong in infrastructure config and merges with defaults.
 */

import type { KongOverride, ResolvedKongConfig, InfraProvider } from './types';
import { mergeKongWithDefaults } from './merge-kong-with-defaults';

/**
 * Get resolved Kong configuration for an environment
 *
 * @param config - Infrastructure config (or null for all defaults)
 * @param environment - Environment name
 * @param provider - Cloud provider ('gcp' or 'aws')
 * @returns Fully resolved Kong configuration
 */
export function getKongConfig(
  config: { [env: string]: unknown } | null,
  environment: string,
  provider: InfraProvider,
): ResolvedKongConfig {
  // No config file - use all defaults
  if (!config) {
    return mergeKongWithDefaults(undefined, provider);
  }

  // Get environment overrides
  const envConfig = config[environment];
  if (!envConfig || typeof envConfig !== 'object') {
    return mergeKongWithDefaults(undefined, provider);
  }

  // Get Kong override
  const kongOverride = (envConfig as { kong?: KongOverride }).kong;

  return mergeKongWithDefaults(kongOverride, provider);
}
