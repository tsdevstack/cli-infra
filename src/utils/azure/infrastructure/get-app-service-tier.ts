/**
 * Get App Service Tier
 *
 * Resolves an App Service SKU (B1, S2, P1v3, ...) to its tier limits.
 */

import { getContext } from '../../../context';
import { APP_SERVICE_TIERS, VALID_APP_SERVICE_SKUS } from '../../../constants';

export interface AppServiceTier {
  name: string;
  maxInstances: number;
  autoscale: boolean;
}

/**
 * @param sku - App Service plan SKU from infrastructure.json
 * @returns The tier's name, instance limit and whether it can autoscale
 * @throws CliError for a SKU the framework does not know
 */
export function getAppServiceTier(sku: string): AppServiceTier {
  const tier =
    APP_SERVICE_TIERS[sku.charAt(0) as keyof typeof APP_SERVICE_TIERS];
  if (
    tier === undefined ||
    !(VALID_APP_SERVICE_SKUS as readonly string[]).includes(sku)
  ) {
    const { CliError } = getContext();
    throw new CliError(
      `Unknown App Service SKU "${sku}"`,
      'Infrastructure Config',
      `Valid SKUs: ${VALID_APP_SERVICE_SKUS.join(', ')}`,
    );
  }
  return tier;
}
