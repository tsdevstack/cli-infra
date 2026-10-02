/**
 * Get Provider Schema Config
 *
 * Returns provider-specific configuration values for infrastructure schema generation.
 */

import {
  VALID_DATABASE_TIERS_GCP,
  VALID_DATABASE_TIERS_AWS,
  VALID_DATABASE_TIERS_AZURE,
  VALID_REDIS_TIERS_GCP,
  VALID_REDIS_TIERS_AWS,
  VALID_REDIS_TIERS_AZURE,
  VALID_SERVICE_TYPES_GCP,
  VALID_SERVICE_TYPES_AWS,
  VALID_SERVICE_TYPES_AZURE,
  VALID_APP_SERVICE_SKUS,
  VALID_CPU_VALUES_GCP,
  VALID_CPU_VALUES_AWS,
  VALID_CPU_VALUES_AZURE,
  VALID_MEMORY_VALUES_GCP,
  VALID_MEMORY_VALUES_AWS,
  VALID_MEMORY_VALUES_AZURE,
  VALIDATION_CONSTRAINTS,
} from '../../constants';

export type SchemaProvider = 'gcp' | 'aws' | 'azure';

export interface ProviderSchemaConfig {
  databaseTiers: readonly string[];
  redisTiers: readonly string[];
  serviceTypes: readonly string[];
  /** App Service SKU values (empty = no App Service support) */
  appServiceSkus: readonly string[];
  /** Whether Kong runs on App Service (true) or container platform (false) */
  kongUsesAppService: boolean;
  /** Whether database.serverName is supported (Azure: server names are global DNS names) */
  supportsDatabaseServerName: boolean;
  databaseDescription: string;
  redisDescription: string;
  redisTierDescription: string;
  serviceDescription: string;
  kongDescription: string;
  scheduledJobDescription: string;
  serviceTypeDescription: string;
  /** Valid CPU values for services and Kong */
  cpuValues: readonly string[];
  /** Valid memory values for services and Kong */
  memoryValues: readonly string[];
  cpuDescription: string;
  memoryDescription: string;
  /** Lowest allowed minInstances for services and Kong (0 = scale-to-zero allowed) */
  minInstancesMinimum: number;
  /** Description of minInstances for services */
  serviceMinInstancesDescription: string;
  /** Description of minInstances for Kong */
  kongMinInstancesDescription: string;
  /** Valid CPU values for migration jobs */
  migrationJobCpuValues: readonly string[];
  /** Valid memory values for migration jobs */
  migrationJobMemoryValues: readonly string[];
  migrationJobDescription: string;
  migrationJobCpuDescription: string;
  migrationJobMemoryDescription: string;
}

export function getProviderSchemaConfig(
  provider: SchemaProvider,
): ProviderSchemaConfig {
  if (provider === 'aws') {
    return {
      databaseTiers: VALID_DATABASE_TIERS_AWS,
      redisTiers: VALID_REDIS_TIERS_AWS,
      serviceTypes: VALID_SERVICE_TYPES_AWS,
      appServiceSkus: [],
      kongUsesAppService: false,
      supportsDatabaseServerName: false,
      databaseDescription: 'RDS PostgreSQL database configuration',
      redisDescription: 'ElastiCache Redis configuration',
      redisTierDescription: 'ElastiCache node type',
      serviceDescription: 'ECS Fargate service configuration',
      kongDescription: 'Kong Gateway configuration (ECS)',
      scheduledJobDescription: 'Scheduled job configuration for EventBridge',
      serviceTypeDescription:
        "Service type: 'nestjs' (ECS), 'nextjs' (ECS + CloudFront), 'spa' (S3+CloudFront), or 'worker' (ECS background)",
      cpuValues: VALID_CPU_VALUES_AWS,
      memoryValues: VALID_MEMORY_VALUES_AWS,
      cpuDescription: 'CPU allocation per instance in vCPU',
      memoryDescription: "Memory allocation (e.g., '1Gi', '2Gi')",
      minInstancesMinimum: VALIDATION_CONSTRAINTS.minInstancesAws.min,
      serviceMinInstancesDescription: `Minimum number of instances (at least ${VALIDATION_CONSTRAINTS.minInstancesAws.min}: AWS has no scale-to-zero)`,
      kongMinInstancesDescription: `Minimum number of instances (at least ${VALIDATION_CONSTRAINTS.minInstancesAws.min}: AWS has no scale-to-zero)`,
      migrationJobCpuValues: ['256', '512', '1024', '2048', '4096'],
      migrationJobMemoryValues: [
        '512',
        '1024',
        '2048',
        '4096',
        '8192',
        '16384',
      ],
      migrationJobDescription:
        'Migration job resource configuration (ECS Task)',
      migrationJobCpuDescription:
        "CPU in ECS units — 256 (0.25 vCPU), 512, 1024 (1 vCPU), 2048, 4096 (default: '1024')",
      migrationJobMemoryDescription: "Memory in MiB (default: '2048')",
    };
  }

  if (provider === 'azure') {
    return {
      databaseTiers: VALID_DATABASE_TIERS_AZURE,
      redisTiers: VALID_REDIS_TIERS_AZURE,
      serviceTypes: VALID_SERVICE_TYPES_AZURE,
      appServiceSkus: VALID_APP_SERVICE_SKUS,
      kongUsesAppService: true,
      supportsDatabaseServerName: true,
      databaseDescription: 'PostgreSQL Flexible Server database configuration',
      redisDescription: 'Azure Managed Redis configuration',
      redisTierDescription: 'Azure Managed Redis SKU',
      serviceDescription: 'Container Apps service configuration',
      kongDescription:
        'Kong Gateway configuration (App Service — SKU controlled via appService.kongSku)',
      scheduledJobDescription:
        'Scheduled job configuration for Container Apps Jobs',
      serviceTypeDescription:
        "Service type: 'nestjs' (Container Apps), 'nextjs' (App Service), 'spa' (Blob Storage), or 'worker' (Container Apps background)",
      cpuValues: VALID_CPU_VALUES_AZURE,
      memoryValues: VALID_MEMORY_VALUES_AZURE,
      cpuDescription: 'CPU allocation per instance in vCPU',
      memoryDescription: "Memory allocation in Gi units (e.g., '1Gi', '2Gi')",
      minInstancesMinimum: VALIDATION_CONSTRAINTS.minInstances.min,
      serviceMinInstancesDescription:
        'Minimum number of instances (0 = scale to zero)',
      kongMinInstancesDescription: 'Minimum number of instances',
      migrationJobCpuValues: [...VALID_CPU_VALUES_AZURE],
      migrationJobMemoryValues: [...VALID_MEMORY_VALUES_AZURE],
      migrationJobDescription:
        'Migration job resource configuration (Container Apps Job)',
      migrationJobCpuDescription:
        "CPU allocation for migration jobs in vCPU (default: '1')",
      migrationJobMemoryDescription:
        "Memory allocation for migration jobs (default: '2Gi')",
    };
  }

  // GCP (default)
  return {
    databaseTiers: VALID_DATABASE_TIERS_GCP,
    redisTiers: VALID_REDIS_TIERS_GCP,
    serviceTypes: VALID_SERVICE_TYPES_GCP,
    appServiceSkus: [],
    kongUsesAppService: false,
    supportsDatabaseServerName: false,
    databaseDescription: 'Cloud SQL database configuration',
    redisDescription: 'Memorystore Redis configuration',
    redisTierDescription:
      "Redis tier: 'BASIC' or 'STANDARD_HA' (high availability)",
    serviceDescription: 'Cloud Run service configuration',
    kongDescription: 'Kong Gateway configuration (Cloud Run)',
    scheduledJobDescription: 'Scheduled job configuration for Cloud Scheduler',
    serviceTypeDescription:
      "Hosting type: 'cloudrun' (Cloud Run) or 'spa' (Cloud Storage + CDN)",
    cpuValues: VALID_CPU_VALUES_GCP,
    memoryValues: VALID_MEMORY_VALUES_GCP,
    cpuDescription: 'CPU allocation per instance in vCPU',
    memoryDescription: "Memory allocation (e.g., '512Mi', '1Gi', '2Gi')",
    minInstancesMinimum: VALIDATION_CONSTRAINTS.minInstances.min,
    serviceMinInstancesDescription:
      'Minimum number of instances (0 = scale to zero)',
    kongMinInstancesDescription: 'Minimum number of instances',
    migrationJobCpuValues: [...VALID_CPU_VALUES_GCP],
    migrationJobMemoryValues: [...VALID_MEMORY_VALUES_GCP],
    migrationJobDescription:
      'Migration job resource configuration (Cloud Run Job)',
    migrationJobCpuDescription:
      "CPU allocation for migration jobs in vCPU (default: '1')",
    migrationJobMemoryDescription:
      "Memory allocation for migration jobs (default: '2Gi')",
  };
}
