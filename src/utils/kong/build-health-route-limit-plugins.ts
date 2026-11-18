/**
 * Kong's rate-limiting plugin for the health route's Kong service, so the
 * probes of the AWS load balancer, Azure Front Door and App Service never
 * count against the global limit (100 a minute by default): a probe that
 * gets 429 marks Kong unhealthy.
 *
 * Kong applies a service's own plugin over the global one of the same name,
 * and the open-source version cannot turn a global plugin off for one
 * service, so this sets a limit of its own: per IP address, counted in each
 * Kong instance (no Redis, so probes pass even when Redis is down), far
 * above what probes send. Nothing when the config has no global limit.
 */

import { getContext } from '../../context';
import { KONG_HEALTH_ROUTE_LIMIT_PER_MINUTE } from '../../constants';
import type { KongPlugin, KongTemplate } from '@tsdevstack/cli/plugin';

export function buildHealthRouteLimitPlugins(
  config: KongTemplate,
): KongPlugin[] {
  const { KONG_RATE_LIMITING_PLUGIN_NAME } = getContext();
  const hasGlobalLimit = config.plugins?.some(
    (plugin) => plugin.name === KONG_RATE_LIMITING_PLUGIN_NAME,
  );
  if (!hasGlobalLimit) {
    return [];
  }
  return [
    {
      name: KONG_RATE_LIMITING_PLUGIN_NAME,
      config: {
        minute: KONG_HEALTH_ROUTE_LIMIT_PER_MINUTE,
        limit_by: 'ip',
        policy: 'local',
      },
    },
  ];
}
