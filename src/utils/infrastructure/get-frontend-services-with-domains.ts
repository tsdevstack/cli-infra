/**
 * Extract frontend services with domains from infrastructure.json
 *
 * Used by infra:deploy-lb to determine which services need
 * routing configuration in the load balancer.
 */

import type { gcp } from '@tsdevstack/infra-core';
type FrontendServiceConfig = gcp.FrontendServiceConfig;
import type { EnvironmentOverrides, ServiceOverride } from './types';
import { RESERVED_ENVIRONMENT_KEYS } from './types';

/**
 * Extract frontend services with domains from environment overrides
 * Service type (spa/nextjs/nestjs) is read from config.json
 */
export function getFrontendServicesWithDomains(
  envOverrides: EnvironmentOverrides | undefined,
  frameworkServices: Array<{ name: string; type?: string }>,
): FrontendServiceConfig[] {
  if (!envOverrides) {
    return [];
  }

  const frontendServices: FrontendServiceConfig[] = [];

  // Iterate through all keys in environment overrides
  for (const [key, value] of Object.entries(envOverrides)) {
    // Skip reserved keys (database, redis, network, kong, loadBalancer)
    if (
      RESERVED_ENVIRONMENT_KEYS.includes(
        key as (typeof RESERVED_ENVIRONMENT_KEYS)[number],
      )
    ) {
      continue;
    }

    // Check if this service has a domain configured
    const serviceConfig = value as ServiceOverride | undefined;
    if (serviceConfig?.domain) {
      // Get service type from config.json
      const configService = frameworkServices.find((s) => s.name === key);
      const isSpa = configService?.type === 'spa';

      frontendServices.push({
        name: key,
        domain: serviceConfig.domain,
        type: isSpa ? 'spa' : 'cloudrun',
      });
    }
  }

  return frontendServices;
}
