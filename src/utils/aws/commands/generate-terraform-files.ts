/**
 * Generate Terraform Files for AWS
 *
 * Shared utility for generating all AWS Terraform configuration files.
 * Used by generate, plan, and deploy commands to ensure consistency.
 */

import path from 'node:path';
import { execSync } from 'node:child_process';
import { getContext } from '../../../context';
import {
  aws,
  calculatePoolSize,
  getTotalWorkerMaxInstances,
  type AWSInfraConfig,
} from '@tsdevstack/infra-core';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { validateAwsMinInstances } from '../infrastructure/validate-aws-min-instances';
import { validateDatabaseDiskSize } from '../../infrastructure/validate-database-disk-size';
import { validateDatabaseHa } from '../../infrastructure/validate-database-ha';
import { validateRedisMemoryGb } from '../../infrastructure/validate-redis-memory-gb';
import {
  getServiceConfig,
  getKongConfig,
  getScheduledJobs,
  getDatabaseConfig,
  getRedisConfig,
} from '../../infrastructure/merge-with-defaults';
import type {
  EnvironmentOverrides,
  AccessControlOverride,
  SecurityOverride,
  LoadBalancerOverride,
} from '../../infrastructure/types';
import type { AWSCommandContext } from './types';
import { parseCpuToNumber } from './parse-cpu-to-number';
import { parseMemoryToNumber } from '../../infrastructure/parse-memory-to-number';
import { FARGATE_DEFAULT } from './normalize-fargate-config';
import { convertCronToEventBridge } from './convert-cron-to-eventbridge';
import type { ServiceOverride, KongOverride } from '../../infrastructure/types';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { warnIfSmallDatabasePool } from '../../deploy/warn-if-small-database-pool';

export interface GenerateTerraformFilesOptions {
  /** Log each file as it's generated (used by infra:generate) */
  verbose?: boolean;
}

export interface GenerateTerraformFilesResult {
  outputDir: string;
  generateConfig: AWSInfraConfig;
  servicesWithDatabase: Array<{ name: string; hasDatabase: boolean }>;
}

/**
 * Generate all Terraform configuration files for AWS
 *
 * This is the single source of truth for AWS Terraform file generation.
 * All commands (generate, plan, deploy) use this to ensure consistency.
 */
export function generateTerraformFiles(
  ctx: AWSCommandContext,
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
  const databaseConfig = getDatabaseConfig(infraConfig, ctx.targetEnv, 'aws');
  validateDatabaseDiskSize(ctx.targetEnv, databaseConfig.diskSize, 'aws');
  validateDatabaseHa(ctx.targetEnv, databaseConfig, 'aws');
  const redisConfig = getRedisConfig(infraConfig, ctx.targetEnv, 'aws');
  validateRedisMemoryGb(
    ctx.targetEnv,
    (infraConfig?.[ctx.targetEnv] as EnvironmentOverrides | undefined)?.redis
      ?.memoryGb,
    'aws',
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

  // Validate worker baseService references
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

  // Build state bucket and lock table names
  const stateBucket = `${ctx.projectName}-terraform-state-${ctx.credentials.accountId}`;
  const lockTable = `${ctx.projectName}-terraform-locks`;

  // Get environment config
  const envConfig = infraConfig?.[ctx.targetEnv] as
    EnvironmentOverrides | undefined;

  // Get DOMAIN from secrets
  // DOMAIN secret is the base domain (e.g., "createdevstack.app")
  // Subdomains are derived in Terraform: api.{base}, app.{base}, etc.
  let baseDomain = '';
  try {
    baseDomain = execSync(
      `npx tsdevstack cloud-secrets:get DOMAIN --env ${ctx.targetEnv}`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim();
  } catch {
    // DOMAIN secret not set - domain will be empty
    // CloudFront/ACM will use placeholder or be skipped
    logger.warn('DOMAIN secret not found - CloudFront will use ALB DNS name');
  }

  // Compute pool size inputs
  const dbTier = databaseConfig.tier;
  const totalServiceMax = getTotalServiceMaxInstances(
    frameworkConfig.services,
    infraConfig,
    ctx.targetEnv,
    'aws',
  );
  const totalWorkerMax = getTotalWorkerMaxInstances(frameworkConfig.services, {
    infraConfig,
    targetEnv: ctx.targetEnv,
  });
  const computedPool = calculatePoolSize({
    dbTier,
    provider: 'aws',
    totalServiceMaxInstances: totalServiceMax,
    totalWorkerMaxInstances: totalWorkerMax,
  });
  const computedPoolMax = computedPool.poolMax;
  warnIfSmallDatabasePool(computedPool, dbTier);

  // Build services map (nestjs services only + kong)
  // Use FARGATE_DEFAULT (smallest/cheapest) unless user overrides in infrastructure.json
  // Default minInstances is 1 (from INFRASTRUCTURE_DEFAULTS_AWS); 0 is rejected (no scale-to-zero on AWS)
  // Note: nextjs services are handled separately (nextjs_services map below)
  const services: AWSInfraConfig['services'] = {};
  frameworkConfig.services
    .filter(
      (s) => s.type !== 'worker' && s.type !== 'spa' && s.type !== 'nextjs',
    )
    .forEach((s) => {
      const resolved = getServiceConfig(
        infraConfig,
        s.name,
        ctx.targetEnv,
        'aws',
      );
      validateAwsMinInstances(
        resolved.minInstances,
        `${ctx.targetEnv}.${s.name}`,
      );
      const serviceOverride = envConfig?.[s.name] as
        ServiceOverride | undefined;
      const hasCpuMemoryOverride =
        serviceOverride?.cpu !== undefined ||
        serviceOverride?.memory !== undefined;

      if (hasCpuMemoryOverride) {
        // User override - use their values (let Terraform validate)
        services[s.name] = {
          cpu: parseCpuToNumber(resolved.cpu),
          memory: String(parseMemoryToNumber(resolved.memory)),
          minInstances: resolved.minInstances,
          maxInstances: resolved.maxInstances,
          dbPoolMax: computedPoolMax,
        };
      } else {
        // No override - use smallest valid Fargate config
        services[s.name] = {
          cpu: FARGATE_DEFAULT.cpu,
          memory: String(FARGATE_DEFAULT.memory),
          minInstances: resolved.minInstances,
          maxInstances: resolved.maxInstances,
          dbPoolMax: computedPoolMax,
        };
      }
    });

  // Add kong
  const kongResolved = getKongConfig(infraConfig, ctx.targetEnv, 'aws');
  const kongOverride = envConfig?.kong as KongOverride | undefined;
  const kongHasOverride =
    kongOverride?.cpu !== undefined || kongOverride?.memory !== undefined;
  validateAwsMinInstances(kongResolved.minInstances, `${ctx.targetEnv}.kong`);
  const kongMinInstances = kongResolved.minInstances;

  if (kongHasOverride) {
    services['kong'] = {
      cpu: parseCpuToNumber(kongResolved.cpu),
      memory: String(parseMemoryToNumber(kongResolved.memory)),
      minInstances: kongMinInstances,
      maxInstances: kongResolved.maxInstances,
      dbPoolMax: 0,
    };
  } else {
    services['kong'] = {
      cpu: FARGATE_DEFAULT.cpu,
      memory: String(FARGATE_DEFAULT.memory),
      minInstances: kongMinInstances,
      maxInstances: kongResolved.maxInstances,
      dbPoolMax: 0,
    };
  }

  // Build workers map
  const workers: AWSInfraConfig['workers'] = {};
  frameworkConfig.services
    .filter((s) => s.type === 'worker')
    .forEach((s) => {
      const resolved = getServiceConfig(
        infraConfig,
        s.name,
        ctx.targetEnv,
        'aws',
      );
      const workerOverride = envConfig?.[s.name] as ServiceOverride | undefined;
      const hasWorkerOverride =
        workerOverride?.cpu !== undefined ||
        workerOverride?.memory !== undefined;

      // Workers must always have at least 1 instance (they poll Redis)
      validateAwsMinInstances(
        resolved.minInstances,
        `${ctx.targetEnv}.${s.name}`,
      );
      const workerMinInstances = resolved.minInstances;

      if (hasWorkerOverride) {
        workers[s.name] = {
          cpu: parseCpuToNumber(resolved.cpu),
          memory: String(parseMemoryToNumber(resolved.memory)),
          minInstances: workerMinInstances,
          maxInstances: resolved.maxInstances,
          service: s.baseService ?? s.name.replace(/-worker$/, ''),
          dbPoolMax: computedPoolMax,
        };
      } else {
        workers[s.name] = {
          cpu: FARGATE_DEFAULT.cpu,
          memory: String(FARGATE_DEFAULT.memory),
          minInstances: workerMinInstances,
          maxInstances: resolved.maxInstances,
          service: s.baseService ?? s.name.replace(/-worker$/, ''),
          dbPoolMax: computedPoolMax,
        };
      }
    });

  // Build allDeployables map (services + workers + kong + nextjs)
  // This creates ECR repos for all deployable services
  const allDeployables: AWSInfraConfig['allDeployables'] = {};
  Object.keys(services).forEach((name) => {
    allDeployables[name] = name;
  });
  Object.keys(workers).forEach((name) => {
    allDeployables[name] = name;
  });

  // Build SPA services map
  const spas: AWSInfraConfig['spas'] = {};
  frameworkConfig.services
    .filter((s) => s.type === 'spa')
    .forEach((s) => {
      // Get domain from service override if set
      const serviceOverride = envConfig?.[s.name] as
        { domain?: string } | undefined;
      spas[s.name] = {
        domain: serviceOverride?.domain ?? `${s.name}.${baseDomain}`,
      };
    });

  // Build Next.js services map (ECS Fargate + CloudFront)
  const frontends: AWSInfraConfig['frontends'] = {};
  frameworkConfig.services
    .filter((s) => s.type === 'nextjs')
    .forEach((s) => {
      const resolved = getServiceConfig(
        infraConfig,
        s.name,
        ctx.targetEnv,
        'aws',
      );
      const serviceOverride = envConfig?.[s.name] as
        { domain?: string; cpu?: string; memory?: string } | undefined;
      validateAwsMinInstances(
        resolved.minInstances,
        `${ctx.targetEnv}.${s.name}`,
      );
      const hasCpuMemoryOverride =
        serviceOverride?.cpu !== undefined ||
        serviceOverride?.memory !== undefined;

      // Get domain from service override or use default subdomain
      const serviceDomain =
        serviceOverride?.domain ?? `${s.name}.${baseDomain}`;

      if (hasCpuMemoryOverride) {
        frontends[s.name] = {
          domain: serviceDomain,
          cpu: parseCpuToNumber(resolved.cpu),
          memory: String(parseMemoryToNumber(resolved.memory)),
          minInstances: resolved.minInstances,
          maxInstances: resolved.maxInstances,
        };
      } else {
        // Next.js uses smaller defaults than the other Fargate services
        // 256 CPU = 0.25 vCPU, 512 MB memory (smallest Fargate config)
        frontends[s.name] = {
          domain: serviceDomain,
          cpu: 256,
          memory: '512',
          minInstances: resolved.minInstances,
          maxInstances: resolved.maxInstances,
        };
      }
    });

  // Add Next.js services to allDeployables for ECR repos
  Object.keys(frontends).forEach((name) => {
    allDeployables[name] = name;
  });

  // Build scheduled jobs map from infrastructure config
  const infraScheduledJobs = getScheduledJobs(infraConfig, ctx.targetEnv);
  const scheduledJobs: AWSInfraConfig['scheduledJobs'] = {};
  infraScheduledJobs.forEach((job) => {
    const jobKey = `${job.targetService}-${job.name}`;
    scheduledJobs[jobKey] = {
      name: job.name,
      schedule: convertCronToEventBridge(job.schedule),
      targetService: job.targetService,
      endpoint: job.endpoint,
    };
  });

  const generateConfig: AWSInfraConfig = {
    provider: 'aws',
    projectName: ctx.projectName,
    environment: ctx.targetEnv,
    accountId: ctx.credentials.accountId,
    region: ctx.credentials.region,
    stateBucket,
    lockTable,
    database: {
      tier: databaseConfig.tier,
      storageSizeGb: databaseConfig.diskSize,
      deletionProtection: databaseConfig.deletionProtection,
      backup: databaseConfig.backup,
      ha: databaseConfig.ha,
    },
    redis: { tier: redisConfig.tier },
    servicesWithDatabase,
    baseDomain,
    services,
    workers,
    allDeployables,
    spas,
    frontends,
    storageBuckets: frameworkConfig.storage?.buckets ?? [],
    scheduledJobs,
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
    aws.generateMainTf(generateConfig),
  );
  logFile('main.tf');

  // KMS key for CloudWatch Logs encryption (must come before log groups)
  writeTextFile(path.join(outputDir, 'kms.tf'), aws.generateKmsTf());
  logFile('kms.tf');

  writeTextFile(
    path.join(outputDir, 'variables.tf'),
    aws.generateVariablesTf(generateConfig.servicesWithDatabase),
  );
  logFile('variables.tf');

  // Generate SPA services outputs
  const spaServices = frameworkConfig.services
    .filter((s) => s.type === 'spa')
    .map((s) => ({ name: s.name }));

  writeTextFile(
    path.join(outputDir, 'outputs.tf'),
    aws.generateOutputsTf({ spaServices }),
  );
  logFile('outputs.tf');

  writeTextFile(
    path.join(outputDir, 'terraform.tfvars'),
    aws.generateTfvars(generateConfig),
  );
  logFile('terraform.tfvars');

  writeTextFile(path.join(outputDir, 'network.tf'), aws.generateNetworkTf());
  logFile('network.tf');

  // VPC Flow Logs for security monitoring
  writeTextFile(
    path.join(outputDir, 'vpc-flow-logs.tf'),
    aws.generateVpcFlowLogsTf(),
  );
  logFile('vpc-flow-logs.tf');

  // CloudTrail for API audit logging (SOC 2, GDPR, ISO 27001)
  writeTextFile(
    path.join(outputDir, 'cloudtrail.tf'),
    aws.generateCloudtrailTf(),
  );
  logFile('cloudtrail.tf');

  // Every secret scope a role's prefix could cover: the services (Kong's
  // task role reads no secrets)
  const secretScopes = frameworkConfig.services.map((s) => s.name);
  writeTextFile(
    path.join(outputDir, 'iam.tf'),
    aws.generateIamTf(secretScopes),
  );
  logFile('iam.tf');

  writeTextFile(path.join(outputDir, 'ecr.tf'), aws.generateEcrTf());
  logFile('ecr.tf');

  writeTextFile(path.join(outputDir, 'database.tf'), aws.generateDatabaseTf());
  logFile('database.tf');

  writeTextFile(path.join(outputDir, 'db-init.tf'), aws.generateDbInitTf());
  logFile('db-init.tf');

  writeTextFile(path.join(outputDir, 'db-delete.tf'), aws.generateDbDeleteTf());
  logFile('db-delete.tf');

  writeTextFile(path.join(outputDir, 'redis.tf'), aws.generateRedisTf());
  logFile('redis.tf');

  writeTextFile(path.join(outputDir, 'ecs.tf'), aws.generateEcsTf());
  logFile('ecs.tf');

  writeTextFile(path.join(outputDir, 'logging.tf'), aws.generateLoggingTf());
  logFile('logging.tf');

  writeTextFile(path.join(outputDir, 'alb.tf'), aws.generateAlbTf());
  logFile('alb.tf');

  // WAF with optional custom rules and rate limit from infrastructure.json
  const securityConfig = envConfig?.security as SecurityOverride | undefined;
  const awsCustomWafRules = securityConfig?.waf?.awsCustomRules;
  const wafRateLimit = securityConfig?.waf?.rateLimit;
  writeTextFile(
    path.join(outputDir, 'waf.tf'),
    aws.generateWafTf({
      customRules: awsCustomWafRules,
      rateLimit: wafRateLimit,
    }),
  );
  logFile('waf.tf');

  writeTextFile(path.join(outputDir, 'acm.tf'), aws.generateAcmTf());
  logFile('acm.tf');

  writeTextFile(path.join(outputDir, 'route53.tf'), aws.generateRoute53Tf());
  logFile('route53.tf');

  // Response headers policy (security headers + optional noIndex)
  // Must come before CloudFront distributions that reference it
  const accessControlConfig = envConfig?.accessControl as
    AccessControlOverride | undefined;
  writeTextFile(
    path.join(outputDir, 'response-headers-policy.tf'),
    aws.generateResponseHeadersPolicyTf({
      noIndex: accessControlConfig?.noIndex,
    }),
  );
  logFile('response-headers-policy.tf');

  writeTextFile(
    path.join(outputDir, 'cloudfront.tf'),
    aws.generateCloudfrontTf(),
  );
  logFile('cloudfront.tf');

  writeTextFile(path.join(outputDir, 's3-spa.tf'), aws.generateS3SpaTf());
  logFile('s3-spa.tf');

  writeTextFile(
    path.join(outputDir, 'cloudfront-nextjs.tf'),
    aws.generateNextjsCloudfrontTf(),
  );
  logFile('cloudfront-nextjs.tf');

  // Redirect domains (e.g., old domain → canonical domain via 301)
  const loadBalancerConfig = envConfig?.loadBalancer as
    LoadBalancerOverride | undefined;
  const redirectDomains = loadBalancerConfig?.redirectDomains ?? [];
  if (redirectDomains.length > 0) {
    writeTextFile(
      path.join(outputDir, 'redirect.tf'),
      aws.generateRedirectTf({
        redirectDomains,
        canonicalDomain: baseDomain,
      }),
    );
    logFile('redirect.tf');
  }

  writeTextFile(
    path.join(outputDir, 'eventbridge.tf'),
    aws.generateEventbridgeTf(),
  );
  logFile('eventbridge.tf');

  // Generate Lambda code directories
  const jobInvokerLambdaDir = path.join(outputDir, 'lambda', 'job-invoker');
  ensureDirectory(jobInvokerLambdaDir);
  writeTextFile(
    path.join(jobInvokerLambdaDir, 'index.js'),
    aws.generateJobInvokerLambdaCode(),
  );
  logFile('lambda/job-invoker/index.js');

  // Generate db-init directory (Dockerfile, package.json, index.js)
  const dbInitDir = path.join(outputDir, 'db-init');
  ensureDirectory(dbInitDir);
  const dbInitFiles = aws.generateDbInit();
  writeTextFile(path.join(dbInitDir, 'Dockerfile'), dbInitFiles.dockerfile);
  logFile('db-init/Dockerfile');
  writeTextFile(path.join(dbInitDir, 'package.json'), dbInitFiles.packageJson);
  logFile('db-init/package.json');
  writeTextFile(path.join(dbInitDir, 'index.js'), dbInitFiles.indexJs);
  logFile('db-init/index.js');

  // Generate db-delete directory (Dockerfile, package.json, index.js)
  const dbDeleteDir = path.join(outputDir, 'db-delete');
  ensureDirectory(dbDeleteDir);
  const dbDeleteFiles = aws.generateDbDelete();
  writeTextFile(path.join(dbDeleteDir, 'Dockerfile'), dbDeleteFiles.dockerfile);
  logFile('db-delete/Dockerfile');
  writeTextFile(
    path.join(dbDeleteDir, 'package.json'),
    dbDeleteFiles.packageJson,
  );
  logFile('db-delete/package.json');
  writeTextFile(path.join(dbDeleteDir, 'index.js'), dbDeleteFiles.indexJs);
  logFile('db-delete/index.js');

  // Generate storage.tf when storage buckets are configured
  if (generateConfig.storageBuckets.length > 0) {
    writeTextFile(
      path.join(outputDir, 'storage.tf'),
      aws.generateS3StorageTf(generateConfig),
    );
    logFile('storage.tf');
  }

  return {
    outputDir,
    generateConfig,
    servicesWithDatabase,
  };
}
