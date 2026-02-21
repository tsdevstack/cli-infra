/**
 * Build Terraform -target list for Front Door routes and security policy
 *
 * Used in two-phase deploy recovery: targeted apply on routes + security policy
 * removes custom domain associations before the full apply replaces domains.
 */

import { toTerraformId } from '@tsdevstack/infra-core';
import type { AzureInfraConfig } from '@tsdevstack/infra-core';

/**
 * Build resource addresses for routes and security policy that reference custom domains
 */
export function buildFrontdoorRouteTargets(config: AzureInfraConfig): string[] {
  const targets: string[] = [
    'azurerm_cdn_frontdoor_route.api',
    'azurerm_cdn_frontdoor_security_policy.main',
  ];

  for (const name of Object.keys(config.frontends)) {
    targets.push(`azurerm_cdn_frontdoor_route.nextjs_${toTerraformId(name)}`);
  }

  for (const name of Object.keys(config.spas)) {
    targets.push(`azurerm_cdn_frontdoor_route.spa_${toTerraformId(name)}`);
  }

  return targets;
}
