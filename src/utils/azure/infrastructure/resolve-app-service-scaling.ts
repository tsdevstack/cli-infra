/**
 * Resolve App Service Scaling
 *
 * Turns minInstances and maxInstances into what an App Service plan can do
 * on its SKU: the plan always runs minInstances workers (at least one; App
 * Service cannot scale to zero), and on a tier that can autoscale, a CPU
 * rule scales up to maxInstances when that is above the fixed count. On a
 * Basic plan the ceiling is dropped: an explicit one fails validation, a
 * default one is reported by infra:generate.
 */

import type { AppServicePlanScaling } from '@tsdevstack/infra-core';
import { getAppServiceTier } from './get-app-service-tier';

export function resolveAppServiceScaling(
  sku: string,
  minInstances: number,
  maxInstances: number,
): AppServicePlanScaling {
  const tier = getAppServiceTier(sku);
  const instances = Math.max(minInstances, 1);
  const autoscaleMax =
    tier.autoscale && maxInstances > instances ? maxInstances : null;
  return { instances, autoscaleMax };
}
