/**
 * Kong's tracing plugin for one Kong service, at sampling rate 0, so the
 * requests it serves are not traced: the health route that the AWS load
 * balancer and Azure Front Door probe every few seconds.
 *
 * Kong applies a service's own plugin over the global one. The plugin
 * repeats the global config (its endpoint is required) with the rate at 0.
 * Nothing when the config has no tracing plugin.
 */

import { getContext } from '../../context';
import type { KongPlugin, KongTemplate } from '@tsdevstack/cli/plugin';

export function buildUntracedPlugins(config: KongTemplate): KongPlugin[] {
  const { KONG_OPENTELEMETRY_PLUGIN_NAME } = getContext();
  const tracing = config.plugins?.find(
    (plugin) => plugin.name === KONG_OPENTELEMETRY_PLUGIN_NAME,
  );
  if (!tracing) {
    return [];
  }
  return [
    {
      name: tracing.name,
      config: { ...tracing.config, sampling_rate: 0 },
    },
  ];
}
