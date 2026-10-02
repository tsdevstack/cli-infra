/**
 * Add ssl and ssl_verify to a Kong plugin's Redis config
 */

import type { KongPlugin } from '@tsdevstack/cli/plugin';
import { KONG_REDIS_TLS_PLUGINS } from '../../constants';

const TLS_PLUGINS: ReadonlySet<string> = new Set(KONG_REDIS_TLS_PLUGINS);

/**
 * Returns the plugin with `ssl: true` and `ssl_verify: false` in its `redis`
 * block, for rate-limiting and tsdevstack-api-key (both use the
 * kong.tools.redis.schema fields). Other plugins, and plugins without a
 * `redis` block, are returned unchanged.
 *
 * @param plugin - Kong plugin entry
 * @returns A new entry with TLS, or the same entry
 */
export function addTlsToPlugin(plugin: KongPlugin): KongPlugin {
  if (!TLS_PLUGINS.has(plugin.name)) return plugin;

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
