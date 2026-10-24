/**
 * Generate Terraform Files
 *
 * Shared utility for generating all Terraform configuration files.
 * Used by generate, plan, and deploy commands to ensure consistency.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import {
  gcp,
  type GCPInfraConfig,
  type ScheduledJobConfig,
} from '@tsdevstack/infra-core';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { validateDatabaseDiskSize } from '../../infrastructure/validate-database-disk-size';
import { validateDatabaseHa } from '../../infrastructure/validate-database-ha';
import { validateRedisMemoryGb } from '../../infrastructure/validate-redis-memory-gb';
import {
  getDatabaseConfig,
  getRedisConfig,
  getScheduledJobs,
} from '../../infrastructure/merge-with-defaults';
import { getFrontendServicesWithDomains } from '../../infrastructure/get-frontend-services-with-domains';
import type {
  EnvironmentOverrides,
  SecurityOverride,
  LoadBalancerOverride,
  AccessControlOverride,
} from '../../infrastructure/types';
import type { GCPCommandContext } from './types';

export interface GenerateTerraformFilesOptions {
  /** Log each file as it's generated (used by infra:generate) */
  verbose?: boolean;
}

export interface GenerateTerraformFilesResult {
  outputDir: string;
  generateConfig: GCPInfraConfig;
  scheduledJobs: ScheduledJobConfig[];
  servicesWithDatabase: Array<{ name: string; hasDatabase: boolean }>;
}

/**
 * Generate all Terraform configuration files
 *
 * This is the single source of truth for Terraform file generation.
 * All commands (generate, plan, deploy) use this to ensure consistency.
 */
export function generateTerraformFiles(
  ctx: GCPCommandContext,
  commandName: string,
  options: GenerateTerraformFilesOptions = {},
): GenerateTerraformFilesResult {
  const { verbose = false } = options;
  const {
    logger,
    CliError,
    loadFrameworkConfig,
    ensureDirectory,
    writeTextFile,
    cleanupFolder,
  } = getContext();

  const frameworkConfig = loadFrameworkConfig();
  const infraConfig = loadInfrastructureConfig();
  const databaseConfig = getDatabaseConfig(infraConfig, ctx.targetEnv, 'gcp');
  validateDatabaseDiskSize(ctx.targetEnv, databaseConfig.diskSize, 'gcp');
  validateDatabaseHa(ctx.targetEnv, databaseConfig, 'gcp');
  const redisConfig = getRedisConfig(infraConfig, ctx.targetEnv, 'gcp');
  validateRedisMemoryGb(
    ctx.targetEnv,
    (infraConfig?.[ctx.targetEnv] as EnvironmentOverrides | undefined)?.redis
      ?.memoryGb,
    'gcp',
  );

  const outputDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );
  ensureDirectory(outputDir);

  // Clean up old generated files (handles provider switching, stale subdirs)
  cleanupFolder(outputDir, ['.terraform', '.terraform.lock.hcl']);

  // Get services with database
  const servicesWithDatabase = frameworkConfig.services.map((s) => ({
    name: s.name,
    hasDatabase: s.hasDatabase ?? false,
  }));

  // Get service names for validation
  const serviceNames = new Set(frameworkConfig.services.map((s) => s.name));

  // Validate worker baseService references (workers deploy via CLI, not Terraform)
  frameworkConfig.services
    .filter((s) => s.type === 'worker' && s.baseService)
    .forEach((s) => {
      if (!serviceNames.has(s.baseService!)) {
        throw new CliError(
          `Worker '${s.name}' references non-existent baseService '${s.baseService}'`,
          commandName,
          `Ensure '${s.baseService}' is defined in services`,
        );
      }
    });

  // Get scheduled jobs and validate targetService references
  const scheduledJobs = getScheduledJobs(infraConfig, ctx.targetEnv);
  for (const job of scheduledJobs) {
    if (!serviceNames.has(job.targetService)) {
      throw new CliError(
        `Scheduled job '${job.name}' references non-existent targetService '${job.targetService}'`,
        commandName,
        `Ensure '${job.targetService}' is defined in services`,
      );
    }
  }

  // Map framework config to GCPInfraConfig
  // diskSize → storageSizeGb, add deletionProtection
  const generateConfig: GCPInfraConfig = {
    provider: 'gcp',
    projectName: ctx.projectName,
    environment: ctx.targetEnv,
    gcpProjectId: ctx.credentials.project_id,
    region: ctx.credentials.region,
    stateBucket: `${ctx.projectName}-tf-state-${ctx.credentials.project_id}`,
    baseDomain: '',
    database: {
      tier: databaseConfig.tier,
      storageSizeGb: databaseConfig.diskSize,
      deletionProtection: databaseConfig.deletionProtection,
      ha: databaseConfig.ha,
      backup: databaseConfig.backup,
    },
    redis: {
      tier: redisConfig.tier,
      memoryGb: redisConfig.memoryGb,
    },
    servicesWithDatabase,
    services: {},
    frontends: {},
    spas: {},
    workers: {},
    storageBuckets: frameworkConfig.storage?.buckets ?? [],
    scheduledJobs: {},
    allDeployables: {},
  };

  logger.generating('Generating configuration files...');

  // Helper to log file creation in verbose mode
  const logFile = (filename: string): void => {
    if (verbose) {
      logger.success(`  ✓ ${filename}`);
    }
  };

  // Generate all Terraform files in consistent order
  writeTextFile(
    path.join(outputDir, 'main.tf'),
    gcp.generateMainTf(generateConfig),
  );
  logFile('main.tf');

  writeTextFile(
    path.join(outputDir, 'variables.tf'),
    gcp.generateVariablesTf(generateConfig.servicesWithDatabase),
  );
  logFile('variables.tf');

  writeTextFile(path.join(outputDir, 'network.tf'), gcp.generateNetworkTf());
  logFile('network.tf');

  writeTextFile(
    path.join(outputDir, 'database.tf'),
    gcp.generateDatabaseTf(generateConfig),
  );
  logFile('database.tf');

  writeTextFile(path.join(outputDir, 'redis.tf'), gcp.generateRedisTf());
  logFile('redis.tf');

  // Generate IAM with all services for per-service runtime SAs
  const allServices = frameworkConfig.services.map((s) => ({ name: s.name }));
  writeTextFile(path.join(outputDir, 'iam.tf'), gcp.generateIamTf(allServices));
  logFile('iam.tf');

  writeTextFile(
    path.join(outputDir, 'artifact-registry.tf'),
    gcp.generateArtifactRegistryTf(),
  );
  logFile('artifact-registry.tf');

  // Generate SPA buckets for services with type 'spa'
  const spaServices = frameworkConfig.services
    .filter((s) => s.type === 'spa')
    .map((s) => ({ name: s.name }));
  writeTextFile(
    path.join(outputDir, 'spa-buckets.tf'),
    gcp.generateSpaBucketsTf(spaServices),
  );
  logFile('spa-buckets.tf');

  writeTextFile(
    path.join(outputDir, 'outputs.tf'),
    gcp.generateOutputsTf({ spaServices }),
  );
  logFile('outputs.tf');

  writeTextFile(
    path.join(outputDir, 'terraform.tfvars'),
    gcp.generateTfvars(generateConfig),
  );
  logFile('terraform.tfvars');

  // Generate loadbalancer.tf if frontend services have domains configured.
  // IAM bindings are handled at deploy time (setServiceInvokerPolicy), not in Terraform,
  // so this is safe to generate even on a fresh project where services don't exist yet.
  const envOverrides = infraConfig?.[ctx.targetEnv] as
    EnvironmentOverrides | undefined;
  const frontendServices = getFrontendServicesWithDomains(
    envOverrides,
    frameworkConfig.services,
  );

  if (frontendServices.length > 0) {
    const loadBalancerConfig = envOverrides?.loadBalancer as
      LoadBalancerOverride | undefined;
    const securityConfig = envOverrides?.security as
      SecurityOverride | undefined;
    const accessControl = envOverrides?.accessControl as
      AccessControlOverride | undefined;

    const baseDomain = frontendServices[0].domain;
    const apiDomain = loadBalancerConfig?.apiDomain ?? `api.${baseDomain}`;

    const lbTf = gcp.generateLoadBalancerTf({
      apiDomain,
      frontendServices,
      customWafRules: securityConfig?.waf?.customRules,
      rateLimit: securityConfig?.waf?.rateLimit,
      redirectDomains: loadBalancerConfig?.redirectDomains,
      canonicalDomain: baseDomain,
      noIndex: accessControl?.noIndex,
    });

    writeTextFile(path.join(outputDir, 'loadbalancer.tf'), lbTf);
    logFile('loadbalancer.tf');
  }

  // Generate cloud-scheduler.tf when scheduled jobs are configured.
  // Uses computed Cloud Run URLs (no dependency on existing services).
  if (scheduledJobs.length > 0) {
    writeTextFile(
      path.join(outputDir, 'cloud-scheduler.tf'),
      gcp.generateCloudSchedulerTf(scheduledJobs),
    );
    logFile('cloud-scheduler.tf');
  }

  // Generate storage.tf when storage buckets are configured
  if (generateConfig.storageBuckets.length > 0) {
    writeTextFile(
      path.join(outputDir, 'storage.tf'),
      gcp.generateGcsStorageTf(generateConfig),
    );
    logFile('storage.tf');
  }

  return {
    outputDir,
    generateConfig,
    scheduledJobs,
    servicesWithDatabase,
  };
}
