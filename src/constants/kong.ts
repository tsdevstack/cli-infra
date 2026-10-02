/**
 * Kong constants (cloud generation)
 */

/**
 * Kong plugins whose `redis` block (kong.tools.redis.schema fields) gets
 * `ssl: true` / `ssl_verify: false` on AWS ElastiCache and Azure Managed
 * Redis: the bundled rate-limiting (global limiter, per-IP ceiling on
 * partner services) and the framework's API key plugin.
 */
export const KONG_REDIS_TLS_PLUGINS = [
  'rate-limiting',
  'tsdevstack-api-key',
] as const;
