/**
 * infra:generate-kong Command
 *
 * Generates Kong declarative configuration for cloud deployment.
 * Parses OpenAPI specs and creates security-based routing.
 */

import path from 'node:path';
import * as yaml from 'js-yaml';
import { execSync } from 'node:child_process';
import { getContext } from '../context';
import { toServiceEnvVarName } from '@tsdevstack/infra-core';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { addAwsHealthToKongConfig } from '../utils/kong/aws/add-aws-health-to-kong-config';
import { addRedisTlsToKongConfig } from '../utils/kong/add-redis-tls-to-kong-config';
import { addAzureHealthToKongConfig } from '../utils/kong/azure/add-azure-health-to-kong-config';
import { extractPlaceholders } from '../utils/kong/extract-placeholders';
import type {
  KongTemplate,
  PartnerApiSettings,
  ServiceRouteConfig,
  ParsedServiceSecurity,
} from '@tsdevstack/cli/plugin';

interface InfraKongGenerateOptions {
  env?: string;
}

/**
 * Generate Kong configuration for cloud deployment
 */
export async function infraKongGenerate(
  options: InfraKongGenerateOptions,
): Promise<void> {
  const {
    logger,
    loadFrameworkConfig,
    hasAuthTemplate,
    CliError,
    parseOpenApiSecurity,
    generateSecurityBasedServices,
    mergeKongConfigs,
    isFile,
    readYamlFile,
    readJsonFile,
    ensureDirectory,
    writeTextFile,
    resolveGlobalPrefix,
    buildFrameworkKongConfig,
    validateRequestTransformerHeaders,
    validateStripIdentityPlugin,
    resolveApiKeyIpLimit,
    buildApiKeyDefaultLimits,
    warnStaticPartnerConsumers,
  } = getContext();

  logger.newline();
  logger.info('Generating Kong configuration for cloud deployment...');
  logger.newline();

  // Set up command context (handles environment resolution with interactive menu)
  const ctx = await setupInfraCommand(options, 'infra:generate-kong');
  const { projectRoot, targetEnv } = ctx;

  const config = loadFrameworkConfig();
  logger.info(`Environment: ${targetEnv}`);

  const useAuthTemplate = hasAuthTemplate(config);

  // Output directory (needed early for escape hatch path)
  const outputDir = path.join(projectRoot, 'infrastructure', 'kong', targetEnv);
  ensureDirectory(outputDir);

  // Check for escape hatch: kong.custom.yml takes full control
  const customConfigPath = path.join(projectRoot, 'kong.custom.yml');
  if (isFile(customConfigPath)) {
    logger.warn('kong.custom.yml detected - Using custom Kong configuration');
    logger.newline();

    const customConfig = readYamlFile<KongTemplate>(customConfigPath);
    validateStripIdentityPlugin(customConfig, 'kong.custom.yml');
    validateRequestTransformerHeaders(customConfig, 'kong.custom.yml');
    const outputPath = path.join(outputDir, 'kong.yml');
    writeTextFile(outputPath, yaml.dump(customConfig, { lineWidth: -1 }));

    logger.complete('Kong configuration generated (custom mode)!');
    logger.newline();
    logger.info(`Output: ${outputPath}`);
    logger.newline();
    logger.info('Next steps:');
    logger.info('  npx tsdevstack infra:build-kong --env ' + targetEnv);
    logger.info('  npx tsdevstack infra:deploy-kong --env ' + targetEnv);
    logger.newline();
    return;
  }

  // Get NestJS services (only those with OpenAPI specs)
  const nestjsServices = config.services.filter((s) => s.type === 'nestjs');

  if (nestjsServices.length === 0) {
    logger.warn('No NestJS services found');
    return;
  }

  // Find auth service for JWT plugin configuration (only required when using auth template)
  const authService = nestjsServices.find((s) => s.name.includes('auth'));
  if (useAuthTemplate && !authService) {
    throw new CliError(
      'No auth service found',
      'infra:generate-kong',
      'Kong requires an auth service for JWT validation when using auth template. Ensure you have a service with "auth" in the name.',
    );
  }

  if (!useAuthTemplate) {
    logger.info(
      'No auth template - routes will use external OIDC provider (${OIDC_DISCOVERY_URL})',
    );
  } else {
    logger.info(`Auth service: ${authService!.name}`);
  }
  logger.info(`Services: ${nestjsServices.map((s) => s.name).join(', ')}`);
  logger.newline();

  // Generate OpenAPI specs for all services (framework handles this automatically)
  logger.generating('Generating OpenAPI specs...');
  for (const service of nestjsServices) {
    const packageJsonPath = path.join(
      projectRoot,
      'apps',
      service.name,
      'package.json',
    );
    if (!isFile(packageJsonPath)) {
      logger.warn(`  No package.json for ${service.name}, skipping`);
      continue;
    }

    // Check if docs:generate script exists
    const packageJson = readJsonFile<{ scripts?: Record<string, string> }>(
      packageJsonPath,
    );
    if (!packageJson.scripts?.['docs:generate']) {
      logger.warn(`  No docs:generate script for ${service.name}, skipping`);
      continue;
    }

    try {
      execSync(`npm run docs:generate -w ${service.name}`, {
        cwd: projectRoot,
        stdio: 'pipe',
      });
      logger.success(`  ${service.name}`);
    } catch (error) {
      logger.warn(
        `  Failed to generate for ${service.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
  logger.newline();

  // Parse OpenAPI specs for each service
  logger.generating('Parsing OpenAPI specs...');
  const parsedServices: ParsedServiceSecurity[] = [];

  for (const service of nestjsServices) {
    const openApiPath = path.join(
      projectRoot,
      'apps',
      service.name,
      'docs',
      'openapi.json',
    );

    if (!isFile(openApiPath)) {
      logger.warn(`  No OpenAPI spec found for ${service.name}, skipping`);
      continue;
    }

    try {
      const parsed = parseOpenApiSecurity(service.name, openApiPath);
      parsedServices.push(parsed);
      logger.success(
        `  ${service.name} (${Object.values(parsed.groupedRoutes).flat().length} routes)`,
      );
    } catch (error) {
      logger.warn(
        `  Failed to parse ${service.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  if (parsedServices.length === 0) {
    throw new CliError(
      'No services with valid OpenAPI specs found',
      'infra:generate-kong',
      'Generate OpenAPI specs first: npm run docs:generate -w <service>',
    );
  }

  logger.newline();

  // kong.user.yml is read before the services are generated: the partner
  // services' API key default limits come from its global rate-limiting
  const userConfigPath = path.join(projectRoot, 'kong.user.yml');
  const userConfig = isFile(userConfigPath)
    ? readYamlFile<KongTemplate>(userConfigPath)
    : undefined;
  if (userConfig) {
    validateRequestTransformerHeaders(userConfig, 'kong.user.yml');
    warnStaticPartnerConsumers(userConfig, 'kong.user.yml');
  }

  const hasPartnerRoutes = parsedServices.some(
    (parsed) => parsed.groupedRoutes.partner.length > 0,
  );
  const partnerApi: PartnerApiSettings = {
    defaultLimits: hasPartnerRoutes ? buildApiKeyDefaultLimits(userConfig) : {},
    ipLimitPerMinute: resolveApiKeyIpLimit(config),
  };

  logger.generating('Generating Kong services...');

  // Generate Kong services for each parsed service
  // Use placeholder URLs that will be resolved from cloud secrets
  const allServices = [];

  for (const parsed of parsedServices) {
    const service = nestjsServices.find((s) => s.name === parsed.serviceName);
    if (!service) continue;

    // Convert service name to env var format: offers-service -> OFFERS_SERVICE_URL
    const serviceEnvVar = `\${${toServiceEnvVarName(service.name)}_URL}`;

    // Build service route config - use auth service URL or OIDC discovery URL based on template
    const serviceRouteConfig: ServiceRouteConfig = {
      serviceName: service.name,
      serviceUrl: serviceEnvVar,
      globalPrefix: resolveGlobalPrefix(service),
      groupedRoutes: parsed.groupedRoutes,
      partnerApi,
      ...(useAuthTemplate && authService
        ? {
            authServiceUrl: `\${${toServiceEnvVarName(authService.name)}_URL}`,
            authServicePrefix: authService.globalPrefix || 'auth',
          }
        : {
            oidcDiscoveryUrl: '${OIDC_DISCOVERY_URL}',
          }),
    };

    const kongServices = generateSecurityBasedServices(serviceRouteConfig);
    allServices.push(...kongServices);

    const routeCount = kongServices.reduce(
      (acc, s) => acc + (s.routes?.length || 0),
      0,
    );
    logger.success(
      `  ${service.name} → ${kongServices.length} Kong services, ${routeCount} routes`,
    );
  }

  // Build framework config (same services and framework global plugins as
  // the local generate-kong)
  const frameworkConfig = buildFrameworkKongConfig(allServices);

  // Merge the user config (kong.user.yml in project root)
  let finalConfig: KongTemplate = frameworkConfig;

  if (userConfig) {
    logger.info('  Merging with kong.user.yml...');
    finalConfig = mergeKongConfigs(frameworkConfig, userConfig);
  } else {
    logger.warn(
      '  kong.user.yml not found — plugins (CORS, rate-limiting, etc.) will be missing.',
    );
    logger.warn("    Run 'npx tsdevstack generate-kong' to create it.");
  }

  // AWS: Add health check route for the ALB target group health check
  // AWS: Add Redis TLS for ElastiCache transit encryption (global limiter,
  // per-IP ceiling and API key plugin)
  // Service URLs stay placeholders, resolved at build time to Cloud Map URLs
  if (ctx.provider === 'aws') {
    logger.info('  Adding AWS health check route...');
    finalConfig = addAwsHealthToKongConfig(finalConfig);

    logger.info('  Adding Redis TLS for ElastiCache...');
    finalConfig = addRedisTlsToKongConfig(finalConfig);
  }

  // Azure: Add health check route for Front Door health probes
  // Azure: Add Redis TLS for Azure Managed Redis Enterprise
  if (ctx.provider === 'azure') {
    logger.info('  Adding Azure health check route...');
    finalConfig = addAzureHealthToKongConfig(finalConfig);

    logger.info('  Adding Redis TLS for Azure Managed Redis...');
    finalConfig = addRedisTlsToKongConfig(finalConfig);
  }

  // Write single merged config (with placeholders - resolved at deploy time)
  const outputPath = path.join(outputDir, 'kong.yml');
  writeTextFile(outputPath, yaml.dump(finalConfig, { lineWidth: -1 }));

  logger.newline();
  logger.complete('Kong configuration generated!');
  logger.newline();
  logger.info(`Output: ${outputPath}`);
  logger.newline();
  logger.info(
    'Placeholders used (resolved from cloud secrets by infra:build-kong):',
  );
  for (const placeholder of extractPlaceholders(finalConfig).sort()) {
    logger.info(`  \${${placeholder}}`);
  }
  logger.newline();
  logger.info('Next steps:');
  logger.info('  npx tsdevstack infra:build-kong --env ' + targetEnv);
  logger.info('  npx tsdevstack infra:deploy-kong --env ' + targetEnv);
  logger.newline();
}
