/**
 * Validate App Service Scaling (Azure)
 *
 * Kong and the Next.js apps run on App Service plans. The SKU sets the size,
 * and the tier decides how a plan can scale: Basic runs a fixed count
 * (minInstances, up to 3), Standard and Premium can also autoscale on CPU up
 * to maxInstances (10 and 30). A setting App Service cannot honour fails
 * here, naming the field, instead of being ignored: cpu and memory (the SKU
 * sets them), a count above the tier's limit, and maxInstances above
 * minInstances on a Basic plan. minInstances 0 is accepted and runs one
 * instance (App Service cannot scale to zero), as before. Defaults never
 * fail: what a plan runs instead of a default, or of 0, is reported by
 * infra:generate. Also checks appService itself (fields and SKUs).
 */

import { getContext } from '../../../context';
import {
  VALID_APP_SERVICE_FIELDS,
  VALID_APP_SERVICE_SKUS,
  KONG_DEFAULTS_AZURE,
  INFRASTRUCTURE_DEFAULTS_AZURE,
} from '../../../constants';
import { validateEnum } from '../../infrastructure/validate-enum';
import { mergeAppServiceWithDefaults } from '../../infrastructure/merge-app-service-with-defaults';
import { getAppServiceTier } from './get-app-service-tier';
import type {
  AppServiceOverride,
  KongOverride,
  ServiceOverride,
} from '../../infrastructure/types';

export function validateAppServiceScaling(
  env: string,
  overrides: Record<string, unknown>,
  serviceTypes: ReadonlyMap<string, string | undefined>,
): void {
  const { CliError } = getContext();

  const appService = overrides.appService as AppServiceOverride | undefined;
  if (appService !== undefined) {
    if (typeof appService !== 'object' || appService === null) {
      throw new CliError(
        `Invalid ${env}.appService: must be an object`,
        'Infrastructure Config',
        'Example: { "kongSku": "S1", "nextjsSku": "B1" }',
      );
    }
    for (const field of Object.keys(appService)) {
      if (!(VALID_APP_SERVICE_FIELDS as readonly string[]).includes(field)) {
        throw new CliError(
          `Unknown field "${field}" in ${env}.appService`,
          'Infrastructure Config',
          `Valid fields: ${VALID_APP_SERVICE_FIELDS.join(', ')}`,
        );
      }
    }
    for (const field of VALID_APP_SERVICE_FIELDS) {
      if (appService[field] !== undefined) {
        validateEnum(
          appService[field],
          field,
          `${env}.appService`,
          VALID_APP_SERVICE_SKUS,
        );
      }
    }
  }
  const skus = mergeAppServiceWithDefaults(appService);

  // One plan for Kong, one shared by every Next.js app
  const plans: Array<{
    context: string;
    what: string;
    skuField: 'kongSku' | 'nextjsSku';
    override: KongOverride | ServiceOverride | undefined;
    defaultMin: number;
  }> = [
    {
      context: `${env}.kong`,
      what: 'Kong runs',
      skuField: 'kongSku',
      override: overrides.kong as KongOverride | undefined,
      defaultMin: KONG_DEFAULTS_AZURE.minInstances,
    },
  ];
  for (const [name, type] of serviceTypes) {
    if (type === 'nextjs') {
      plans.push({
        context: `${env}.${name}`,
        what: 'Next.js apps run',
        skuField: 'nextjsSku',
        override: overrides[name] as ServiceOverride | undefined,
        defaultMin: INFRASTRUCTURE_DEFAULTS_AZURE.minInstances,
      });
    }
  }

  for (const plan of plans) {
    const o = plan.override;
    if (o === undefined || typeof o !== 'object' || o === null) continue;
    const sku = skus[plan.skuField];
    const skuHint = `appService.${plan.skuField}`;
    const tier = getAppServiceTier(sku);

    for (const field of ['cpu', 'memory'] as const) {
      if (o[field] !== undefined) {
        throw new CliError(
          `${plan.context}.${field} has no effect on Azure: ${plan.what} on App Service, where ${skuHint} sets the size`,
          'Infrastructure Config',
          `Remove ${field}, or change ${skuHint} (${sku} now)`,
        );
      }
    }

    const instances = Math.max(o.minInstances ?? plan.defaultMin, 1);
    const above = tier.autoscale ? 'Premium' : 'Standard or Premium';
    for (const field of ['minInstances', 'maxInstances'] as const) {
      const value = o[field];
      if (typeof value === 'number' && value > tier.maxInstances) {
        throw new CliError(
          `${plan.context}.${field}: ${value} is above the ${tier.name} limit of ${tier.maxInstances} instances (${skuHint} ${sku})`,
          'Infrastructure Config',
          `Use a ${above} SKU, or at most ${tier.maxInstances}`,
        );
      }
    }

    if (
      !tier.autoscale &&
      typeof o.maxInstances === 'number' &&
      o.maxInstances > instances
    ) {
      throw new CliError(
        `${plan.context}.maxInstances: ${o.maxInstances} is above minInstances (${instances}) on a ${tier.name} plan (${skuHint} ${sku}), which cannot autoscale`,
        'Infrastructure Config',
        `Set ${skuHint} to S1 or higher for CPU autoscale, or set maxInstances to ${instances} for a fixed count`,
      );
    }
  }
}
