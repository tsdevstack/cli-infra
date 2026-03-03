/**
 * Infrastructure Configuration Defaults
 *
 * Built-in defaults used when no infrastructure.json override exists.
 * Based on Phase 13 config spec v1.0.0.
 */

/**
 * Default values for service configuration (GCP Cloud Run)
 *
 * minInstances: 1 ensures services are always warm (no cold starts).
 * Set to 0 explicitly in infrastructure.json for dev environments to enable scale-to-zero.
 */
export const INFRASTRUCTURE_DEFAULTS_GCP = {
  minInstances: 1,
  maxInstances: 10,
  cpu: '1',
  memory: '512Mi',
  timeout: '300s',
  port: 3000,
  concurrency: 80,
} as const;

/**
 * Default values for service configuration (AWS Fargate/App Runner)
 *
 * CPU/memory must be valid Fargate combinations:
 * - 0.5 vCPU: 1GB-4GB
 * - 1 vCPU: 2GB-8GB
 * - 2 vCPU: 4GB-16GB
 */
export const INFRASTRUCTURE_DEFAULTS_AWS = {
  minInstances: 1,
  maxInstances: 10,
  cpu: '0.5',
  memory: '1Gi',
  timeout: '300s',
  port: 3000,
  concurrency: 80,
} as const;

/**
 * Default values for database configuration (GCP Cloud SQL)
 */
export const DATABASE_DEFAULTS_GCP = {
  tier: 'db-f1-micro',
  diskSize: 10,
  deletionProtection: true,
  ha: false,
  backup: true,
} as const;

/**
 * Default values for database configuration (AWS RDS)
 */
export const DATABASE_DEFAULTS_AWS = {
  tier: 'db.t3.micro',
  diskSize: 20,
  deletionProtection: true,
  ha: false,
  backup: true,
} as const;

/**
 * Default values for Redis configuration (GCP Memorystore)
 */
export const REDIS_DEFAULTS_GCP = {
  tier: 'BASIC',
  memoryGb: 1,
} as const;

/**
 * Default values for Redis configuration (AWS ElastiCache)
 */
export const REDIS_DEFAULTS_AWS = {
  tier: 'cache.t3.micro',
  memoryGb: 1,
} as const;

/**
 * Default values for migration job resources (GCP Cloud Run Job)
 *
 * Values are in Cloud Run native format: vCPU string + Kubernetes-style memory.
 */
export const MIGRATION_JOB_DEFAULTS_GCP = {
  cpu: '1',
  memory: '2Gi',
} as const;

/**
 * Default values for migration job resources (AWS ECS Task)
 *
 * Values are in ECS native format: CPU units (1024 = 1 vCPU) + MiB string.
 */
export const MIGRATION_JOB_DEFAULTS_AWS = {
  cpu: '1024',
  memory: '2048',
} as const;

/**
 * Default values for migration job resources (Azure Container Apps Job)
 *
 * Values stored as strings (cpu converted to number by runner).
 */
export const MIGRATION_JOB_DEFAULTS_AZURE = {
  cpu: '1',
  memory: '2Gi',
} as const;

/**
 * Valid CPU values per provider
 */
export const VALID_CPU_VALUES_GCP = [
  '0.25',
  '0.5',
  '1',
  '2',
  '4',
  '8',
] as const;
export const VALID_CPU_VALUES_AWS = ['0.25', '0.5', '1', '2', '4'] as const;
export const VALID_CPU_VALUES_AZURE = ['0.25', '0.5', '1', '2', '4'] as const;

// TODO(phase-28): Replace with provider-specific values in validate-service-override.ts,
// generate-infrastructure-schema.ts, get-provider-schema-config.ts
export const VALID_CPU_VALUES = VALID_CPU_VALUES_GCP;

/**
 * Valid memory values per provider
 *
 * GCP Cloud Run accepts both Mi and Gi.
 * AWS Fargate accepts Mi and Gi.
 * Azure Container Apps only accepts Gi.
 */
export const VALID_MEMORY_VALUES_GCP = [
  '256Mi',
  '512Mi',
  '0.5Gi',
  '1Gi',
  '2Gi',
  '4Gi',
  '8Gi',
] as const;

export const VALID_MEMORY_VALUES_AWS = [
  '512Mi',
  '1Gi',
  '2Gi',
  '4Gi',
  '8Gi',
  '16Gi',
] as const;

export const VALID_MEMORY_VALUES_AZURE = [
  '0.5Gi',
  '1Gi',
  '2Gi',
  '4Gi',
] as const;

// TODO(phase-28): Replace with provider-specific values
export const VALID_MEMORY_VALUES = VALID_MEMORY_VALUES_GCP;

/**
 * Supported infrastructure.json versions
 * Must match exactly - no ranges or fuzzy matching
 */
export const SUPPORTED_VERSIONS = ['1.0.0'] as const;

/**
 * Validation constraints for service configuration
 */
export const VALIDATION_CONSTRAINTS = {
  minInstances: { min: 0, max: 100 },
  maxInstances: { min: 1, max: 100 },
  timeout: { minSeconds: 30, maxSeconds: 3600 },
  port: { min: 1, max: 65535 },
  concurrency: { min: 1, max: 1000 },
} as const;

/**
 * Infrastructure config filename
 */
export const INFRASTRUCTURE_CONFIG_FILENAME = 'infrastructure.json';

/**
 * Infrastructure schema filename
 */
export const INFRASTRUCTURE_SCHEMA_FILENAME = 'infrastructure.schema.json';

/**
 * Valid Cloud SQL database tiers (GCP)
 */
export const VALID_DATABASE_TIERS_GCP = [
  'db-f1-micro',
  'db-g1-small',
  'db-n1-standard-1',
  'db-n1-standard-2',
  'db-n1-standard-4',
] as const;

/**
 * Valid RDS database tiers (AWS)
 */
export const VALID_DATABASE_TIERS_AWS = [
  'db.t3.micro',
  'db.t3.small',
  'db.t3.medium',
  'db.t3.large',
  'db.r5.large',
  'db.r5.xlarge',
] as const;

/**
 * Valid Redis tiers - Memorystore (GCP)
 */
export const VALID_REDIS_TIERS_GCP = ['BASIC', 'STANDARD_HA'] as const;

/**
 * Valid Redis tiers - ElastiCache (AWS)
 */
export const VALID_REDIS_TIERS_AWS = [
  'cache.t3.micro',
  'cache.t3.small',
  'cache.t3.medium',
  'cache.r5.large',
  'cache.r5.xlarge',
] as const;

/**
 * Valid service types (GCP)
 */
export const VALID_SERVICE_TYPES_GCP = ['cloudrun', 'spa'] as const;

/**
 * Valid service types (AWS)
 */
export const VALID_SERVICE_TYPES_AWS = [
  'nestjs',
  'nextjs',
  'spa',
  'worker',
] as const;

/**
 * Database validation constraints
 */
export const DATABASE_CONSTRAINTS = {
  diskSize: { min: 10, max: 1000 },
} as const;

/**
 * Redis validation constraints
 */
export const REDIS_CONSTRAINTS = {
  memoryGb: { min: 1, max: 300 },
} as const;

/**
 * Default values for Kong Gateway configuration (GCP Cloud Run)
 *
 * minInstances: 1 ensures Kong is always available.
 * Set to 0 explicitly in infrastructure.json for dev environments to enable scale-to-zero.
 */
export const KONG_DEFAULTS_GCP = {
  minInstances: 1,
  maxInstances: 10,
  cpu: '1',
  memory: '1Gi',
} as const;

/**
 * Default values for Kong Gateway configuration (AWS ECS Fargate)
 *
 * minInstances: 1 ensures Kong is always available (required for AWS wake-up failover).
 * CPU/memory must be valid Fargate combination (1 vCPU requires 2GB minimum).
 */
export const KONG_DEFAULTS_AWS = {
  minInstances: 1,
  maxInstances: 10,
  cpu: '1',
  memory: '2Gi',
} as const;

/**
 * Default values for database configuration (Azure PostgreSQL Flexible Server)
 */
export const DATABASE_DEFAULTS_AZURE = {
  tier: 'B_Standard_B1ms',
  diskSize: 32,
  deletionProtection: true,
  ha: false,
  backup: false,
} as const;

/**
 * Default values for Redis configuration (Azure Managed Redis)
 */
export const REDIS_DEFAULTS_AZURE = {
  tier: 'Balanced_B0',
  memoryGb: 1,
} as const;

/**
 * Default values for service configuration (Azure Container Apps)
 *
 * minInstances: 0 enables scale-to-zero for dev environments.
 * CPU/memory must be valid Container Apps combinations.
 */
export const INFRASTRUCTURE_DEFAULTS_AZURE = {
  minInstances: 0,
  maxInstances: 5,
  cpu: '0.25',
  memory: '0.5Gi',
  timeout: '300s',
  port: 3000,
  concurrency: 80,
} as const;

/**
 * Default values for Kong Gateway configuration (Azure Container Apps)
 *
 * minInstances: 1 ensures Kong is always available.
 * Kong minInstances is enforced to at least 1 regardless of infrastructure.json.
 */
export const KONG_DEFAULTS_AZURE = {
  minInstances: 1,
  maxInstances: 5,
  cpu: '0.5',
  memory: '1Gi',
} as const;

/**
 * Default values for App Service configuration (Azure)
 *
 * Kong gets a dedicated plan, Next.js apps share one plan.
 * B1 is the minimum tier that supports always_on.
 */
export const APP_SERVICE_DEFAULTS_AZURE = {
  kongSku: 'B1',
  nextjsSku: 'B1',
} as const;

/**
 * Valid PostgreSQL Flexible Server tiers (Azure)
 */
export const VALID_DATABASE_TIERS_AZURE = [
  'B_Standard_B1ms',
  'B_Standard_B2s',
  'GP_Standard_D2s_v3',
  'GP_Standard_D4s_v3',
  'MO_Standard_E4s_v3',
] as const;

/**
 * Valid Azure Managed Redis tiers
 */
export const VALID_REDIS_TIERS_AZURE = [
  'Balanced_B0',
  'Balanced_B1',
  'MemoryOptimized_M10',
  'MemoryOptimized_M20',
] as const;

/**
 * Valid service types (Azure)
 */
export const VALID_SERVICE_TYPES_AZURE = [
  'nestjs',
  'nextjs',
  'spa',
  'worker',
] as const;
