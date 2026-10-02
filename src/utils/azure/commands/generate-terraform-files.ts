/**
 * Generate all Azure Terraform configuration files
 *
 * Orchestrates the individual generators to produce the complete
 * Terraform configuration for Azure infrastructure.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import {
  azure,
  type AzureInfraConfig,
  type WafConfig,
} from '@tsdevstack/infra-core';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import {
  getScheduledJobs,
  getDatabaseConfig,
  getRedisConfig,
  getServiceConfig,
  getAppServiceConfig,
} from '../../infrastructure/merge-with-defaults';
import type { SecurityOverride } from '../../infrastructure/types';
import { resolvePostgresServerName } from '../resolve-postgres-server-name';
import type { AzureCommandContext } from './types';

interface GenerateOptions {
  verbose?: boolean;
  /** Skip custom domain associations in routes and security policy (for two-phase deploy recovery) */
  skipCustomDomainAssociations?: boolean;
}

interface GenerateResult {
  outputDir: string;
  generateConfig: AzureInfraConfig;
}

/**
 * Generate Terraform files for Azure infrastructure
 */
export function generateTerraformFiles(
  ctx: AzureCommandContext,
  commandName: string,
  options: GenerateOptions = {},
): GenerateResult {
  const {
    logger,
    loadFrameworkConfig,
    ensureDirectory,
    writeTextFile,
    executeCommand,
    cleanupFolder,
  } = getContext();
  const { verbose } = options;

  const config = loadFrameworkConfig();
  const projectName = config.project.name;
  const infraConfig = loadInfrastructureConfig();
  const databaseConfig = getDatabaseConfig(infraConfig, ctx.targetEnv, 'azure');
  const redisConfig = getRedisConfig(infraConfig, ctx.targetEnv, 'azure');
  const appServiceConfig = getAppServiceConfig(infraConfig, ctx.targetEnv);
  const postgresServerName = resolvePostgresServerName(
    projectName,
    ctx.targetEnv,
    infraConfig,
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

  // Build storage account name (must match bootstrap)
  const sanitizedName = projectName.replace(/[^a-z0-9]/g, '');
  const storageAccountName = `${sanitizedName}${ctx.targetEnv}tfstate`;

  // Build services map from framework config
  const services: Record<
    string,
    { cpu: number; memory: string; minInstances: number; maxInstances: number }
  > = {};
  const allDeployables: Record<string, string> = {};
  const servicesWithDatabase: Array<{ name: string; hasDatabase: boolean }> =
    [];
  const spas: Record<string, { domain: string }> = {};
  const frontends: Record<
    string,
    {
      domain: string;
      cpu: number;
      memory: string;
      minInstances: number;
      maxInstances: number;
    }
  > = {};

  for (const service of config.services) {
    if (service.type === 'nestjs') {
      const svcConfig = getServiceConfig(
        infraConfig,
        service.name,
        ctx.targetEnv,
        'azure',
      );
      services[service.name] = {
        cpu: parseFloat(svcConfig.cpu),
        memory: svcConfig.memory,
        minInstances: svcConfig.minInstances,
        maxInstances: svcConfig.maxInstances,
      };
      allDeployables[service.name] = 'placeholder';
      servicesWithDatabase.push({
        name: service.name,
        hasDatabase: service.hasDatabase !== false,
      });
    } else if (service.type === 'nextjs') {
      const svcConfig = getServiceConfig(
        infraConfig,
        service.name,
        ctx.targetEnv,
        'azure',
      );
      frontends[service.name] = {
        domain: '',
        cpu: parseFloat(svcConfig.cpu),
        memory: svcConfig.memory,
        minInstances: svcConfig.minInstances,
        maxInstances: svcConfig.maxInstances,
      };
      allDeployables[service.name] = 'placeholder';
    } else if (service.type === 'spa') {
      spas[service.name] = { domain: '' };
    }
  }

  // Get DOMAIN from secrets
  // DOMAIN secret is the base domain (e.g., "example.com")
  // Subdomains are derived: api.{base}, {service}.{base}, etc.
  let baseDomain = '';
  try {
    const output = executeCommand(
      `npx tsdevstack cloud-secrets:get DOMAIN --env ${ctx.targetEnv}`,
      { stdio: 'pipe', logCommand: false, exitOnError: false },
    );
    baseDomain = (output as string).trim();
  } catch {
    // DOMAIN secret not set — custom domains will be skipped
    logger.warn(
      'DOMAIN secret not found — Front Door will use default endpoints',
    );
  }

  // Wire per-service domains from infrastructure.json (full domain) or derive from baseDomain
  if (baseDomain) {
    for (const [name, spaConfig] of Object.entries(spas)) {
      spaConfig.domain =
        getServiceDomain(infraConfig, name, ctx.targetEnv) ||
        `${name}.${baseDomain}`;
    }
    for (const [name, nextjsConfig] of Object.entries(frontends)) {
      nextjsConfig.domain =
        getServiceDomain(infraConfig, name, ctx.targetEnv) ||
        `${name}.${baseDomain}`;
    }
  }

  // Kong is deployed to App Service (not Container Apps), so it's not in the services map.
  // Always include it in allDeployables for ACR repo creation.
  allDeployables['kong'] = 'placeholder';

  const generateConfig: AzureInfraConfig = {
    provider: 'azure',
    projectName,
    environment: ctx.targetEnv,
    subscriptionId: ctx.credentials.subscriptionId,
    location: ctx.credentials.location,
    storageAccountName,
    database: {
      tier: databaseConfig.tier,
      storageSizeGb: databaseConfig.diskSize,
      deletionProtection: getDeleteProtection(infraConfig, ctx.targetEnv),
      backup: databaseConfig.backup,
      // Only pass an override: the default name stays a Terraform expression
      ...(postgresServerName.isOverride
        ? { serverName: postgresServerName.name }
        : {}),
    },
    redis: { tier: redisConfig.tier },
    servicesWithDatabase,
    baseDomain,
    services,
    workers: {},
    allDeployables,
    spas,
    frontends,
    storageBuckets: config.storage?.buckets ?? [],
    scheduledJobs: buildScheduledJobsMap(ctx.targetEnv),
    waf: getWafConfig(infraConfig, ctx.targetEnv),
    noIndex: getNoIndex(infraConfig, ctx.targetEnv),
    frontdoorPremium: getFrontdoorPremium(infraConfig, ctx.targetEnv),
    skipCustomDomainAssociations: options.skipCustomDomainAssociations,
    kongAppServiceSku: appServiceConfig.kongSku,
    nextjsAppServiceSku: appServiceConfig.nextjsSku,
  };

  // Generate core files
  const files: Array<{ name: string; content: string }> = [
    { name: 'main.tf', content: azure.generateMainTf(generateConfig) },
    {
      name: 'variables.tf',
      content: azure.generateVariablesTf(generateConfig),
    },
    { name: 'terraform.tfvars', content: azure.generateTfvars(generateConfig) },
    { name: 'outputs.tf', content: azure.generateOutputsTf(generateConfig) },
    { name: 'network.tf', content: azure.generateNetworkTf() },
    { name: 'acr.tf', content: azure.generateAcrTf() },
    {
      name: 'container-apps-env.tf',
      content: azure.generateContainerAppsEnvTf(),
    },
    {
      name: 'container-apps-identity.tf',
      content: azure.generateContainerAppsIdentityTf(),
    },
    { name: 'database.tf', content: azure.generateDatabaseTf(generateConfig) },
    { name: 'redis.tf', content: azure.generateRedisTf(generateConfig) },
    {
      name: 'frontdoor.tf',
      content: azure.generateFrontdoorTf(generateConfig),
    },
    {
      name: 'spa-storage.tf',
      content: azure.generateSpaStorageTf(generateConfig),
    },
    { name: 'dns.tf', content: azure.generateDnsTf(generateConfig) },
    { name: 'waf.tf', content: azure.generateWafTf(generateConfig) },
    {
      name: 'app-service.tf',
      content: azure.generateAppServiceTf(generateConfig),
    },
    {
      name: 'diagnostics.tf',
      content: azure.generateDiagnosticsTf(generateConfig),
    },
  ];

  // Add scheduled-jobs.tf only when jobs are configured
  const scheduledJobsContent = azure.generateScheduledJobsTf(generateConfig);
  if (scheduledJobsContent) {
    files.push({
      name: 'scheduled-jobs.tf',
      content: scheduledJobsContent,
    });
  }

  // Add storage.tf when storage buckets are configured
  if (generateConfig.storageBuckets.length > 0) {
    files.push({
      name: 'storage.tf',
      content: azure.generateBlobStorageTf(generateConfig),
    });
  }

  for (const file of files) {
    const filePath = path.join(outputDir, file.name);
    writeTextFile(filePath, file.content);
    if (verbose) {
      logger.generating(`  ${file.name}`);
    }
  }

  return { outputDir, generateConfig };
}

/**
 * Build scheduled jobs map from infrastructure config
 */
function buildScheduledJobsMap(
  targetEnv: string,
): AzureInfraConfig['scheduledJobs'] {
  const infraConfig = loadInfrastructureConfig();
  const jobs = getScheduledJobs(infraConfig, targetEnv);
  const jobsMap: AzureInfraConfig['scheduledJobs'] = {};

  for (const job of jobs) {
    const key = buildScheduledJobKey(job.targetService, job.name);
    jobsMap[key] = {
      name: job.name,
      schedule: job.schedule,
      targetService: job.targetService,
      endpoint: job.endpoint,
    };
  }

  return jobsMap;
}

/**
 * Build the Terraform map key for a scheduled job
 * Uses just jobName to stay within Azure's 32-char Container App Job name limit.
 */
function buildScheduledJobKey(_targetService: string, jobName: string): string {
  return jobName;
}

/**
 * Get deletionProtection from raw infrastructure config
 */
function getDeleteProtection(
  config: { [env: string]: unknown } | null,
  env: string,
): boolean {
  if (!config) return false;
  const envConfig = config[env];
  if (!envConfig || typeof envConfig !== 'object') return false;
  const db = (envConfig as { database?: { deletionProtection?: boolean } })
    .database;
  return db?.deletionProtection ?? false;
}

/**
 * Get domain from service override in infrastructure config
 */
function getServiceDomain(
  config: { [env: string]: unknown } | null,
  serviceName: string,
  env: string,
): string {
  if (!config) return '';
  const envConfig = config[env];
  if (!envConfig || typeof envConfig !== 'object') return '';
  const svc = (envConfig as Record<string, unknown>)[serviceName];
  if (!svc || typeof svc !== 'object') return '';
  const domain = (svc as { domain?: string }).domain;
  return domain ?? '';
}

/**
 * Get noIndex from raw infrastructure config accessControl
 */
function getNoIndex(
  config: { [env: string]: unknown } | null,
  env: string,
): boolean {
  if (!config) return false;
  const envConfig = config[env];
  if (!envConfig || typeof envConfig !== 'object') return false;
  const ac = (envConfig as { accessControl?: { noIndex?: boolean } })
    .accessControl;
  return ac?.noIndex ?? false;
}

/**
 * Get frontdoorPremium from raw infrastructure config
 */
function getFrontdoorPremium(
  config: { [env: string]: unknown } | null,
  env: string,
): boolean {
  if (!config) return false;
  const envConfig = config[env];
  if (!envConfig || typeof envConfig !== 'object') return false;
  return (
    (envConfig as { frontdoorPremium?: boolean }).frontdoorPremium ?? false
  );
}

/**
 * Get WAF config from raw infrastructure config
 */
function getWafConfig(
  config: { [env: string]: unknown } | null,
  env: string,
): WafConfig | undefined {
  if (!config) return undefined;
  const envConfig = config[env];
  if (!envConfig || typeof envConfig !== 'object') return undefined;
  const security = (envConfig as { security?: SecurityOverride }).security;
  if (!security?.waf) return undefined;
  return {
    azureCustomRules: security.waf.azureCustomRules,
    rateLimit: security.waf.rateLimit,
  };
}
