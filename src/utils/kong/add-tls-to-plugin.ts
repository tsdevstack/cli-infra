/**
 * Add ssl and ssl_verify to a rate-limiting plugin's Redis config
 */

import type { KongPlugin } from '@tsdevstack/cli/plugin';

export function addTlsToPlugin(plugin: KongPlugin): KongPlugin {
  if (plugin.name !== 'rate-limiting') return plugin;

  const redis = plugin.config.redis as Record<string, unknown> | undefined;
  if (!redis) return plugin;

  return {
    ...plugin,
    config: {
      ...plugin.config,
      redis: {
        ...redis,
        ssl: true,
        ssl_verify: false,
      },
    },
  };
}
