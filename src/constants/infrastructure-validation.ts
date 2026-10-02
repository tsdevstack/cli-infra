/**
 * Infrastructure validation constants
 *
 * Valid field names for configuration validation.
 * Types derived from these constants are in utils/infrastructure/types.ts.
 */

/**
 * Valid field names in ServiceOverride
 */
export const VALID_OVERRIDE_FIELDS = [
  'minInstances',
  'maxInstances',
  'cpu',
  'memory',
  'timeout',
  'port',
  'concurrency',
  'domain',
  'type',
] as const;

/**
 * Reserved keys in environment overrides (not service names)
 */
export const RESERVED_ENVIRONMENT_KEYS = [
  'database',
  'redis',
  'kong',
  'loadBalancer',
  'security',
  'accessControl',
  'scheduledJobs',
  'appService',
  'frontdoorPremium',
] as const;

/**
 * Valid field names in DatabaseOverride
 */
export const VALID_DATABASE_FIELDS = [
  'tier',
  'diskSize',
  'ha',
  'backup',
  'migrationJob',
  'serverName',
] as const;

/**
 * Valid field names in MigrationJobConfig
 */
export const VALID_MIGRATION_JOB_FIELDS = ['cpu', 'memory'] as const;

/**
 * Valid field names in RedisOverride
 */
export const VALID_REDIS_FIELDS = ['tier', 'memoryGb'] as const;

/**
 * Valid field names in KongOverride
 */
export const VALID_KONG_FIELDS = [
  'minInstances',
  'maxInstances',
  'cpu',
  'memory',
] as const;

/**
 * Valid field names in LoadBalancerOverride
 */
export const VALID_LOADBALANCER_FIELDS = [
  'apiDomain',
  'redirectDomains',
] as const;

/**
 * Valid field names in AccessControlOverride
 */
export const VALID_ACCESS_CONTROL_FIELDS = ['noIndex'] as const;

/**
 * Removed field names in AccessControlOverride (environment password
 * protection was removed). Configs that still set them fail validation.
 */
export const REMOVED_ACCESS_CONTROL_FIELDS = [
  'protected',
  'cookieTtlHours',
] as const;

/**
 * Valid field names in ScheduledJobConfig
 */
export const VALID_SCHEDULED_JOB_FIELDS = [
  'name',
  'schedule',
  'targetService',
  'endpoint',
  'method',
  'httpTimeout',
  'timezone',
] as const;

/**
 * Valid field names in AppServiceOverride
 */
export const VALID_APP_SERVICE_FIELDS = ['kongSku', 'nextjsSku'] as const;

/**
 * Valid App Service Plan SKUs (Azure)
 */
export const VALID_APP_SERVICE_SKUS = [
  'B1',
  'B2',
  'B3',
  'S1',
  'S2',
  'S3',
  'P1v3',
  'P2v3',
  'P3v3',
] as const;
