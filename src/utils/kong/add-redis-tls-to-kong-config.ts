/**
 * Add Redis TLS settings to Kong rate-limiting plugins
 *
 * AWS ElastiCache with transit encryption requires TLS connections.
 * This function adds ssl: true and ssl_verify: false to all rate-limiting
 * plugin Redis configs in the Kong configuration.
 *
 * GCP Memorystore doesn't require this - it uses unencrypted connections
 * within the VPC.
 */

import type { KongTemplate, KongPlugin } from '@tsdevstack/cli/plugin';

/**
 * Add ssl and ssl_verify to a rate-limiting plugin's Redis config
 */
function addTlsToPlugin(plugin: KongPlugin): KongPlugin {
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

export function addRedisTlsToKongConfig(config: KongTemplate): KongTemplate {
  // Transform global plugins
  const plugins = config.plugins?.map(addTlsToPlugin);

  // Transform consumer-level plugins
  const consumers = config.consumers?.map((consumer) => {
    if (!consumer.plugins) return consumer;

    return {
      ...consumer,
      plugins: consumer.plugins.map(addTlsToPlugin),
    };
  });

  return {
    ...config,
    ...(plugins && { plugins }),
    ...(consumers && { consumers }),
  };
}
