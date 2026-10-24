/**
 * Add TLS with certificate verification to a Kong plugin's Redis config
 */

import { isIP } from 'node:net';
import type { KongPlugin } from '@tsdevstack/cli/plugin';
import { KONG_REDIS_TLS_PLUGINS } from '../../constants';

const TLS_PLUGINS: ReadonlySet<string> = new Set(KONG_REDIS_TLS_PLUGINS);

/**
 * Returns the plugin with TLS in its `redis` block, for rate-limiting and
 * tsdevstack-api-key (both use the kong.tools.redis.schema fields):
 * `ssl: true`, `ssl_verify: true` and `server_name` set to the Redis host, so
 * Kong checks the certificate chain (system CA bundle, see the Kong
 * Dockerfile) and the hostname. ElastiCache and Azure Managed Redis present
 * publicly trusted certificates for their endpoint names.
 *
 * An explicit `ssl_verify` or `server_name` in the plugin config is kept.
 * `server_name` is left out for an IP address: Kong accepts only hostnames
 * there. The host is usually the `${REDIS_HOST}` placeholder, which
 * infra:build-kong resolves in both fields.
 *
 * Other plugins, and plugins without a `redis` block, are returned unchanged.
 *
 * @param plugin - Kong plugin entry
 * @returns A new entry with TLS, or the same entry
 */
export function addTlsToPlugin(plugin: KongPlugin): KongPlugin {
  if (!TLS_PLUGINS.has(plugin.name)) return plugin;

  const redis = plugin.config.redis as Record<string, unknown> | undefined;
  if (!redis) return plugin;

  const host = redis.host;
  const serverName =
    redis.server_name ??
    (typeof host === 'string' && isIP(host) === 0 ? host : undefined);

  return {
    ...plugin,
    config: {
      ...plugin.config,
      redis: {
        ...redis,
        ssl: true,
        ssl_verify: redis.ssl_verify ?? true,
        ...(serverName !== undefined && { server_name: serverName }),
      },
    },
  };
}
