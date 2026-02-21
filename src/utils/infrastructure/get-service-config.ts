/**
 * Get Service Configuration
 *
 * Looks up service in infrastructure config and merges with defaults.
 */

import type {
  ServiceOverride,
  ResolvedServiceConfig,
  InfraProvider,
} from './types';
import { mergeServiceWithDefaults } from './merge-service-with-defaults';

/**
 * Get resolved configuration for a service
 *
 * Looks up the service in infrastructure config, merges with defaults.
 *
 * @param config - Infrastructure config (or null for all defaults)
 * @param serviceName - Service name
 * @param environment - Environment name
 * @param provider - Cloud provider ('gcp' or 'aws')
 * @returns Fully resolved configuration
 */
export function getServiceConfig(
  config: { [env: string]: unknown } | null,
  serviceName: string,
  environment: string,
  provider: InfraProvider,
): ResolvedServiceConfig {
  // No config file - use all defaults
  if (!config) {
    return mergeServiceWithDefaults(
      undefined,
      serviceName,
      environment,
      provider,
    );
  }

  // Get environment overrides
  const envConfig = config[environment];
  if (!envConfig || typeof envConfig !== 'object') {
    return mergeServiceWithDefaults(
      undefined,
      serviceName,
      environment,
      provider,
    );
  }

  // Get service override
  const serviceOverride = (envConfig as Record<string, ServiceOverride>)[
    serviceName
  ];

  return mergeServiceWithDefaults(
    serviceOverride,
    serviceName,
    environment,
    provider,
  );
}
