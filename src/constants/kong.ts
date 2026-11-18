/**
 * Kong constants (cloud generation)
 */

/**
 * Kong plugins whose `redis` block (kong.tools.redis.schema fields) gets
 * verified TLS (`ssl`, `ssl_verify`, `server_name`) on AWS ElastiCache and
 * Azure Managed Redis: the bundled rate-limiting (global limiter, per-IP
 * ceiling on partner services) and the framework's API key plugin.
 */
export const KONG_REDIS_TLS_PLUGINS = [
  'rate-limiting',
  'tsdevstack-api-key',
] as const;

/**
 * Requests per minute from one IP address on Kong's health route (AWS
 * /health, Azure /status). The load balancer, Front Door and App Service
 * probe it every 30 to 60 s from each of their addresses, far below this;
 * the limit only stops one address from hammering a public route.
 */
export const KONG_HEALTH_ROUTE_LIMIT_PER_MINUTE = 600;
