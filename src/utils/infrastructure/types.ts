/**
 * Infrastructure Configuration Types
 *
 * Types for infrastructure.json schema v1.0.0
 */

import {
  VALID_OVERRIDE_FIELDS,
  RESERVED_ENVIRONMENT_KEYS,
  VALID_DATABASE_FIELDS,
  VALID_REDIS_FIELDS,
  VALID_KONG_FIELDS,
  VALID_LOADBALANCER_FIELDS,
  VALID_ACCESS_CONTROL_FIELDS,
  VALID_SCHEDULED_JOB_FIELDS,
  VALID_APP_SERVICE_FIELDS,
  VALID_MIGRATION_JOB_FIELDS,
} from '../../constants';

export {
  VALID_OVERRIDE_FIELDS,
  RESERVED_ENVIRONMENT_KEYS,
  VALID_DATABASE_FIELDS,
  VALID_REDIS_FIELDS,
  VALID_KONG_FIELDS,
  VALID_LOADBALANCER_FIELDS,
  VALID_ACCESS_CONTROL_FIELDS,
  VALID_SCHEDULED_JOB_FIELDS,
  VALID_APP_SERVICE_FIELDS,
  VALID_MIGRATION_JOB_FIELDS,
};

/**
 * Cloud provider for infrastructure configuration
 */
export type InfraProvider = 'gcp' | 'aws' | 'azure';

/**
 * Scheduled job configuration for Cloud Scheduler
 */
export interface ScheduledJobConfig {
  /** Job name (e.g., "cleanup-tokens") */
  name: string;
  /** Cron schedule (e.g., "0 0 * * *" for daily) */
  schedule: string;
  /** Target service name (e.g., "auth-service") */
  targetService: string;
  /** Endpoint path (e.g., "/jobs/cleanup-tokens") */
  endpoint: string;
  /** HTTP method (default: POST) */
  method?: string;
  /** HTTP timeout in seconds - how long scheduler waits for response (default: 300) */
  httpTimeout?: number;
  /** Timezone (default: UTC) */
  timezone?: string;
}

/**
 * Migration job resource configuration
 *
 * Controls CPU and memory for database migration jobs (Cloud Run Job / ECS Task / Container Apps Job).
 * Values are provider-specific:
 * - GCP: vCPU string ("1", "2") + Kubernetes-style memory ("2Gi")
 * - AWS: ECS CPU units ("256", "1024") + MiB string ("2048")
 * - Azure: vCPU string ("1") + Kubernetes-style memory ("2Gi")
 */
export interface MigrationJobConfig {
  cpu?: string;
  memory?: string;
}

/**
 * Database configuration override (Cloud SQL)
 */
export interface DatabaseOverride {
  tier?: string;
  diskSize?: number;
  deletionProtection?: boolean;
  ha?: boolean;
  backup?: boolean;
  migrationJob?: MigrationJobConfig;
  /**
   * PostgreSQL Flexible Server name override (Azure only).
   * Default: {project}-{environment}-postgres. The name is a global DNS name in Azure.
   */
  serverName?: string;
}

/**
 * Redis configuration override (Memorystore)
 */
export interface RedisOverride {
  tier?: string;
  memoryGb?: number;
}

/**
 * Kong Gateway configuration override (Cloud Run)
 */
export interface KongOverride {
  minInstances?: number;
  maxInstances?: number;
  cpu?: string;
  memory?: string;
  /** Max upload size for traditional file uploads through Kong (e.g., "10m", "50m"). Default: "10m". Set to "0" for unlimited. */
  maxUploadSize?: string;
}

/**
 * App Service configuration override (Azure only)
 *
 * Controls App Service Plan SKUs for Kong and Next.js.
 * Kong gets a dedicated plan, Next.js apps share one plan.
 */
export interface AppServiceOverride {
  kongSku?: string;
  nextjsSku?: string;
}

/**
 * Load Balancer configuration override
 */
export interface LoadBalancerOverride {
  apiDomain?: string;
  /** Redirect domains (e.g., ["example.com", "example.dev"]) - redirect to canonical domain */
  redirectDomains?: string[];
}

/**
 * Rate limit configuration for custom WAF rules
 */
export interface WafRateLimitConfig {
  /** Requests allowed per interval */
  count: number;
  /** Interval in seconds */
  intervalSec: number;
}

/**
 * Custom WAF rule configuration (GCP Cloud Armor)
 *
 * Uses CEL expressions and GCP-specific action formats.
 * For AWS WAF rules, use AwsWafCustomRule instead.
 */
export interface WafCustomRule {
  /** Unique rule identifier */
  name: string;
  /** Rule priority (use 800-899 for custom rules) */
  priority: number;
  /** Action: deny(403), deny(404), deny(429), throttle, allow */
  action: string;
  /** CEL expression (validated by Terraform/GCP) */
  expression: string;
  /** Human-readable description */
  description?: string;
  /** Rate limit config (required if action is throttle) */
  rateLimit?: WafRateLimitConfig;
}

/**
 * AWS WAF byte match configuration
 */
export interface AwsWafByteMatchConfig {
  /** String to search for */
  searchString: string;
  /** Part of the request to inspect */
  fieldToMatch: 'uri_path' | 'query_string' | 'body' | 'header';
  /** Header name (required when fieldToMatch is 'header') */
  headerName?: string;
  /** How to match the string */
  positionalConstraint: 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH' | 'EXACTLY';
}

/**
 * AWS WAF geo match configuration
 */
export interface AwsWafGeoMatchConfig {
  /** ISO 3166-1 alpha-2 country codes (e.g., ["US", "CA", "GB"]) */
  countryCodes: string[];
}

/**
 * Custom WAF rule configuration (AWS WAF v2)
 *
 * Uses AWS WAF statement-based constructs instead of GCP CEL expressions.
 * Supports byte_match, rate_based, and geo_match rule types.
 */
export interface AwsWafCustomRule {
  /** Unique rule identifier */
  name: string;
  /** Rule priority (100-899, managed rules use 1-99) */
  priority: number;
  /** Action when rule matches */
  action: 'block' | 'allow' | 'count';
  /** Human-readable description */
  description?: string;
  /** Match type determines which config is used */
  matchType: 'byte_match' | 'rate_based' | 'geo_match';
  /** Byte match configuration (required when matchType is 'byte_match') */
  byteMatch?: AwsWafByteMatchConfig;
  /** Geo match configuration (required when matchType is 'geo_match') */
  geoMatch?: AwsWafGeoMatchConfig;
  /** Rate limit (requests per 5-minute window, required when matchType is 'rate_based') */
  rateLimit?: number;
}

/**
 * Azure WAF match condition
 *
 * Uses Azure Front Door native match constructs.
 */
export interface AzureWafMatchCondition {
  /** Part of the request to inspect */
  matchVariable:
    | 'RequestUri'
    | 'RequestMethod'
    | 'RequestHeader'
    | 'RequestBody'
    | 'SocketAddr'
    | 'QueryString';
  /** Comparison operator */
  operator: 'Contains' | 'Equal' | 'IPMatch' | 'GreaterThan';
  /** Values to match against */
  matchValues: string[];
  /** Text transforms applied before matching (e.g., ['Lowercase', 'UrlDecode']) */
  transforms?: string[];
  /** Header name (required when matchVariable is 'RequestHeader') */
  selector?: string;
}

/**
 * Custom WAF rule configuration (Azure Front Door)
 *
 * Uses Azure Front Door native rule constructs.
 */
export interface AzureWafCustomRule {
  /** Unique rule name (alphanumeric only) */
  name: string;
  /** Rule type */
  type: 'MatchRule' | 'RateLimitRule';
  /** Rule priority (use 1000+ to avoid conflicts with framework rules) */
  priority: number;
  /** Action when rule matches */
  action: 'Block' | 'Allow' | 'Log';
  /** Match conditions (all must match for the rule to trigger) */
  matchConditions: AzureWafMatchCondition[];
  /** Human-readable description */
  description?: string;
  /** Rate limit duration in minutes (required when type is 'RateLimitRule') */
  rateLimitDurationInMinutes?: number;
  /** Rate limit threshold (required when type is 'RateLimitRule') */
  rateLimitThreshold?: number;
}

/**
 * WAF security configuration override
 */
export interface WafOverride {
  /** Custom WAF rules for GCP Cloud Armor */
  customRules?: WafCustomRule[];
  /** Custom WAF rules for AWS WAF v2 */
  awsCustomRules?: AwsWafCustomRule[];
  /** Custom WAF rules for Azure Front Door */
  azureCustomRules?: AzureWafCustomRule[];
  /** Global rate limit (applied across all providers). Default: { count: 1000, intervalSec: 60 } */
  rateLimit?: WafRateLimitConfig;
}

/**
 * Security configuration override
 */
export interface SecurityOverride {
  waf?: WafOverride;
}

/**
 * Access control configuration
 *
 * - `noIndex`: Add X-Robots-Tag header to prevent search engine indexing
 */
export interface AccessControlOverride {
  /** Add X-Robots-Tag: noindex, nofollow header to prevent search engine indexing */
  noIndex?: boolean;
}

/**
 * Frontend hosting type
 * - "cloudrun": SSR apps (Next.js) on Cloud Run (default)
 * - "spa": Static SPAs on Cloud Storage + CDN
 */
export type FrontendHostingType = 'cloudrun' | 'spa';

/**
 * Service override - partial configuration that overrides defaults
 */
export interface ServiceOverride {
  minInstances?: number;
  maxInstances?: number;
  cpu?: string;
  memory?: string;
  timeout?: string;
  port?: number;
  concurrency?: number;
  /** Full domain for frontend services (e.g., "example.com", "admin.example.com") */
  domain?: string;
  /** Hosting type for frontend services: "cloudrun" (default) or "spa" (Cloud Storage + CDN) */
  type?: FrontendHostingType;
}

/**
 * Environment overrides - map of service name to override, plus optional database/redis/kong/loadBalancer/security config
 */
export interface EnvironmentOverrides {
  database?: DatabaseOverride;
  redis?: RedisOverride;
  kong?: KongOverride;
  loadBalancer?: LoadBalancerOverride;
  security?: SecurityOverride;
  accessControl?: AccessControlOverride;
  scheduledJobs?: ScheduledJobConfig[];
  appService?: AppServiceOverride;
  /** Enable Front Door Premium tier (Private Link, DRS 2.1 managed WAF rulesets) */
  frontdoorPremium?: boolean;
  [serviceName: string]:
    | ServiceOverride
    | DatabaseOverride
    | RedisOverride
    | KongOverride
    | LoadBalancerOverride
    | SecurityOverride
    | AccessControlOverride
    | ScheduledJobConfig[]
    | AppServiceOverride
    | boolean
    | undefined;
}

/**
 * Infrastructure config file structure
 */
export interface InfrastructureConfig {
  version: string;
  [environment: string]: string | EnvironmentOverrides | undefined;
}

/**
 * Resolved service configuration - all fields have values (merged with defaults)
 */
export interface ResolvedServiceConfig {
  minInstances: number;
  maxInstances: number;
  cpu: string;
  memory: string;
  timeout: string;
  port: number;
  concurrency: number;
}

/**
 * Resolved database configuration - all fields have values
 */
export interface ResolvedDatabaseConfig {
  tier: string;
  diskSize: number;
  deletionProtection: boolean;
  ha: boolean;
  backup: boolean;
  /**
   * Server name override (Azure only). No default here: when absent, the
   * provider derives the name from project and environment.
   */
  serverName?: string;
}

/**
 * Resolved Redis configuration - all fields have values
 */
export interface ResolvedRedisConfig {
  tier: string;
  memoryGb: number;
}

/**
 * Resolved Kong configuration - all fields have values
 */
export interface ResolvedKongConfig {
  minInstances: number;
  maxInstances: number;
  cpu: string;
  memory: string;
  maxUploadSize: string;
}

/**
 * Resolved App Service configuration - all fields have values
 */
export interface ResolvedAppServiceConfig {
  kongSku: string;
  nextjsSku: string;
}

/**
 * Resolved Load Balancer configuration - all fields have values
 */
export interface ResolvedLoadBalancerConfig {
  apiDomain: string;
}

/**
 * Derived types from validation constants
 */
export type ValidOverrideField = (typeof VALID_OVERRIDE_FIELDS)[number];
export type ReservedEnvironmentKey = (typeof RESERVED_ENVIRONMENT_KEYS)[number];
export type ValidDatabaseField = (typeof VALID_DATABASE_FIELDS)[number];
export type ValidRedisField = (typeof VALID_REDIS_FIELDS)[number];
export type ValidKongField = (typeof VALID_KONG_FIELDS)[number];
export type ValidLoadBalancerField = (typeof VALID_LOADBALANCER_FIELDS)[number];
export type ValidAccessControlField =
  (typeof VALID_ACCESS_CONTROL_FIELDS)[number];
export type ValidScheduledJobField =
  (typeof VALID_SCHEDULED_JOB_FIELDS)[number];
export type ValidAppServiceField = (typeof VALID_APP_SERVICE_FIELDS)[number];
