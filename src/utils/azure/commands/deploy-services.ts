/**
 * Azure Deploy Services
 *
 * Orchestrates the complete service deployment workflow for Azure:
 * - NestJS: Docker build → push → Container Apps (internal ingress)
 * - Next.js: Docker build → push → App Service (Access Restrictions)
 * - SPA: Build → upload to Blob Storage
 *
 * Follows the same filtering pattern as GCP: filter first, group by type,
 * deploy each group. Single code path for both single-service and all-services.
 */

import { getContext } from '../../../context';
import { deployContainerAppServices } from './deploy-container-app-services';
import { deployNextjsAppServices } from './deploy-nextjs-app-services';
import { deploySpaServices } from './deploy-spa-services';
import { deployCoupledWorkers } from './deploy-coupled-workers';
import { discoverDeployedServices } from '../discovery';
import {
  checkTopologyDrift,
  isPoolRelevant,
  parseServiceFilter,
} from '@tsdevstack/infra-core';
import type { AzureCommandContext } from './types';

export interface DeployServicesOptions {
  service?: string;
  skipGenerate?: boolean;
  tag?: string;
  maxParallel?: number;
}

export async function azureDeployServices(
  ctx: AzureCommandContext,
  options: DeployServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();
  const { targetEnv } = ctx;
  const config = loadFrameworkConfig();

  const serviceFilter = parseServiceFilter(options.service);

  // Topology check: when deploying a subset of services that affect pool sizing,
  // verify topology hasn't drifted since last full deploy
  if (serviceFilter) {
    const targetServices = config.services.filter((s) =>
      serviceFilter.includes(s.name),
    );
    const hasPoolRelevant = targetServices.some((s) =>
      isPoolRelevant(s, config.services),
    );
    if (hasPoolRelevant) {
      const discoveryResult = await discoverDeployedServices({
        projectName: ctx.projectName,
        targetEnv,
        credentials: ctx.credentials,
      });

      if (!discoveryResult.success) {
        throw new CliError(
          `Cannot verify service topology: ${discoveryResult.error}`,
          'topology-check',
          `Run "npx tsdevstack infra:deploy-services --env ${targetEnv}" to deploy all services.`,
        );
      }

      checkTopologyDrift({
        targetEnv,
        deployedServices: discoveryResult.services,
        configServices: config.services,
      });
    }
  }

  // Filter services: by name(s) from --service, or all deployable types
  const allServices = serviceFilter
    ? config.services.filter((s) => serviceFilter.includes(s.name))
    : config.services.filter(
        (s) => s.type === 'nestjs' || s.type === 'nextjs' || s.type === 'spa',
      );

  if (allServices.length === 0) {
    if (serviceFilter) {
      throw new CliError(
        `Service "${options.service}" not found`,
        'infra:deploy-services',
        `Available services: ${config.services.map((s) => s.name).join(', ')}`,
      );
    }
    logger.warn('No deployable services found');
    return;
  }

  // Validate the service type is deployable (catches workers, etc.)
  if (serviceFilter) {
    for (const service of allServices) {
      if (
        service.type !== 'nestjs' &&
        service.type !== 'nextjs' &&
        service.type !== 'spa'
      ) {
        throw new CliError(
          `Service type "${service.type}" is not deployable`,
          'infra:deploy-services',
          'Deployable types: nestjs, nextjs, spa',
        );
      }
    }
  }

  // Group by type
  const nestjsServices = allServices.filter((s) => s.type === 'nestjs');
  const nextjsServices = allServices.filter((s) => s.type === 'nextjs');
  const spaServices = allServices.filter((s) => s.type === 'spa');

  logger.info(
    `Services to deploy: ${allServices.map((s) => s.name).join(', ')}`,
  );
  logger.newline();

  // Deploy NestJS services to Container Apps
  if (nestjsServices.length > 0) {
    logger.info('════════════════════════════════════════════');
    logger.info('Deploying NestJS Services to Container Apps...');
    logger.info('════════════════════════════════════════════');

    await deployContainerAppServices(ctx, {
      service: options.service,
      tag: options.tag,
      skipGenerate: options.skipGenerate,
      maxParallel: options.maxParallel,
    });
  }

  // Deploy Next.js services to App Service
  if (nextjsServices.length > 0) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.info('Deploying Next.js Services to App Service...');
    logger.info('════════════════════════════════════════════');

    await deployNextjsAppServices(ctx, {
      service: options.service,
      tag: options.tag,
      skipGenerate: options.skipGenerate,
      maxParallel: options.maxParallel,
    });
  }

  // Deploy workers coupled to the deployed docker services
  const dockerServiceNames = [...nestjsServices, ...nextjsServices].map(
    (s) => s.name,
  );
  await deployCoupledWorkers(ctx, config, dockerServiceNames, options.tag);

  // Deploy SPA services to Blob Storage
  if (spaServices.length > 0) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.info('Deploying SPA Services to Blob Storage...');
    logger.info('════════════════════════════════════════════');

    await deploySpaServices(ctx, { service: options.service });
  }

  logger.newline();
  logger.complete('All services deployed successfully!');
  logger.newline();
}
