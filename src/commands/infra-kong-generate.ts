/**
 * infra:generate-kong Command
 *
 * Generates Kong declarative configuration for cloud deployment.
 * Parses OpenAPI specs and creates security-based routing.
 */

import path from 'node:path';
import yaml from 'js-yaml';
import { execSync } from 'node:child_process';
import { getContext } from '../context';
import { toServiceEnvVarName } from '@tsdevstack/infra-core';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { addAwsUpstreamsToKongConfig } from '../utils/kong/add-aws-upstreams-to-kong-config';
import { addRedisTlsToKongConfig } from '../utils/kong/add-redis-tls-to-kong-config';
import { addAzureHealthToKongConfig } from '../utils/kong/add-azure-health-to-kong-config';
import type {
  KongTemplate,
  ServiceRouteConfig,
  ParsedServiceSecurity,
} from 'tsdevstack/plugin';

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
    const outputPath = path.join(outputDir, 'kong.yml');
    writeTextFile(outputPath, yaml.dump(customConfig, { lineWidth: -1 }));

    logger.complete('Kong configuration generated (custom mode)!');
    logger.newline();
    logger.info(`Output: ${outputPath}`);
    logger.newline();
    logger.info('Next steps:');
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
      globalPrefix:
        service.globalPrefix || service.name.replace('-service', ''),
      groupedRoutes: parsed.groupedRoutes,
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

  // Build framework config
  const frameworkConfig: KongTemplate = {
    _format_version: '3.0',
    _transform: true,
    services: allServices,
    consumers: [], // Will be added from user config or cloud secrets
  };

  // Check for user config (kong.user.yml in project root)
  const userConfigPath = path.join(projectRoot, 'kong.user.yml');
  let finalConfig: KongTemplate = frameworkConfig;

  if (isFile(userConfigPath)) {
    logger.info('  Merging with kong.user.yml...');
    const userConfig = readYamlFile<KongTemplate>(userConfigPath);
    finalConfig = mergeKongConfigs(frameworkConfig, userConfig);
  } else {
    logger.warn(
      '  kong.user.yml not found — plugins (CORS, rate-limiting, etc.) will be missing.',
    );
    logger.warn("    Run 'npx tsdevstack generate-kong' to create it.");
  }

  // AWS: Add upstreams with failover targets for scale-to-zero support
  // AWS: Add Redis TLS for ElastiCache transit encryption
  if (ctx.provider === 'aws') {
    logger.info('  Adding AWS upstreams with failover targets...');
    finalConfig = addAwsUpstreamsToKongConfig(finalConfig, {
      projectName: config.project.name,
    });

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
  logger.info('Placeholders used (resolve from cloud secrets):');
  const placeholders = new Set<string>();
  for (const service of nestjsServices) {
    placeholders.add(`  \${${toServiceEnvVarName(service.name)}_URL}`);
  }
  if (!useAuthTemplate) {
    placeholders.add('  ${OIDC_DISCOVERY_URL}');
  }
  Array.from(placeholders).forEach((ph) => {
    logger.info(ph);
  });
  logger.newline();
  logger.info('Next steps:');
  logger.info('  npx tsdevstack infra:deploy-kong --env ' + targetEnv);
  logger.newline();
}
