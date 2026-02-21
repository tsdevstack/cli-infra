/**
 * AWS Deploy Services
 *
 * Orchestrates the complete service deployment workflow for AWS:
 * - NestJS: Docker build → push → ECS
 * - Next.js: Docker build → push → App Runner
 * - Workers: Deployed alongside their base service (same Docker image)
 * - SPA: Build → upload to S3
 *
 * Follows the same filtering pattern as GCP: filter first, group by type,
 * deploy each group. Single code path for both single-service and all-services.
 */

import { getContext } from '../../../context';
import { deployEcsServices } from './deploy-ecs-services';
import { deployAppRunnerServices } from './deploy-apprunner-services';
import { deploySpaServices } from './deploy-spa-services';
import { discoverDeployedServices } from '../discovery';
import {
  checkTopologyDrift,
  isPoolRelevant,
  parseServiceFilter,
} from '@tsdevstack/infra-core';
import type { AWSCommandContext } from './types';

export interface DeployServicesOptions {
  /** Specific service to deploy (optional, deploys all if not specified) */
  service?: string;
  /** Skip Dockerfile generation */
  skipGenerate?: boolean;
  /** Custom image tag */
  tag?: string;
  /** Max parallel operations (default: 2) */
  maxParallel?: number;
}

/**
 * Deploy all services to AWS (ECS, App Runner, S3)
 */
export async function awsDeployServices(
  ctx: AWSCommandContext,
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

  // Deploy NestJS services to ECS
  if (nestjsServices.length > 0) {
    logger.info('════════════════════════════════════════════');
    logger.info('Deploying NestJS Services to ECS...');
    logger.info('════════════════════════════════════════════');

    await deployEcsServices(ctx, {
      service: options.service,
      tag: options.tag,
      skipGenerate: options.skipGenerate,
      maxParallel: options.maxParallel,
    });
  }

  // Deploy Next.js services to App Runner
  if (nextjsServices.length > 0) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.info('Deploying Next.js Services to App Runner...');
    logger.info('════════════════════════════════════════════');

    await deployAppRunnerServices(ctx, { tag: options.tag });
  }

  // Deploy SPA services to S3
  if (spaServices.length > 0) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.info('Deploying SPA Services to S3...');
    logger.info('════════════════════════════════════════════');

    await deploySpaServices(ctx, { service: options.service });
  }

  logger.newline();
  logger.complete('All services deployed successfully!');
  logger.newline();
}
