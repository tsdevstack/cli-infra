/**
 * Merge App Service Override with Defaults
 *
 * Merges partial App Service override with built-in defaults.
 * Azure-only feature — no provider parameter needed.
 */

import { APP_SERVICE_DEFAULTS_AZURE } from '../../constants';
import type { AppServiceOverride, ResolvedAppServiceConfig } from './types';

/**
 * Merge App Service override with defaults
 *
 * @param override - Partial App Service override from infrastructure.json (or undefined)
 * @returns Fully resolved App Service configuration
 */
export function mergeAppServiceWithDefaults(
  override: AppServiceOverride | undefined,
): ResolvedAppServiceConfig {
  return {
    kongSku: override?.kongSku ?? APP_SERVICE_DEFAULTS_AZURE.kongSku,
    nextjsSku: override?.nextjsSku ?? APP_SERVICE_DEFAULTS_AZURE.nextjsSku,
  };
}
