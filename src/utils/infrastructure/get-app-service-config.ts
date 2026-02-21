/**
 * Get App Service Configuration
 *
 * Looks up appService in infrastructure config and merges with defaults.
 */

import type { AppServiceOverride, ResolvedAppServiceConfig } from './types';
import { mergeAppServiceWithDefaults } from './merge-app-service-with-defaults';

/**
 * Get resolved App Service configuration for an environment
 *
 * @param config - Infrastructure config (or null for all defaults)
 * @param environment - Environment name
 * @returns Fully resolved App Service configuration
 */
export function getAppServiceConfig(
  config: { [env: string]: unknown } | null,
  environment: string,
): ResolvedAppServiceConfig {
  if (!config) {
    return mergeAppServiceWithDefaults(undefined);
  }

  const envConfig = config[environment];
  if (!envConfig || typeof envConfig !== 'object') {
    return mergeAppServiceWithDefaults(undefined);
  }

  const override = (envConfig as { appService?: AppServiceOverride })
    .appService;
  return mergeAppServiceWithDefaults(override);
}
