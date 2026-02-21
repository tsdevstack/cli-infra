/**
 * GCP Deploy Services
 *
 * Orchestrates the complete service deployment workflow for GCP:
 * - Backend/Frontend (nestjs, nextjs): Docker build → push → Cloud Run
 * - Workers: Deployed alongside their base service (same Docker image)
 * - SPA: Build → upload to Cloud Storage
 */

import pMap from 'p-map';
import { getContext } from '../../../context';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { infraDbMigrateRun } from '../../../commands/infra-db-migrate-run';
import { infraWorkerDeploy } from '../../../commands/infra-worker-deploy';
import { gcpDeployService } from './deploy-service';
import { deploySpaService } from '../deploy-spa-service';
import { discoverDeployedServices } from '../discovery';
import {
  buildGcpTerraformEnv,
  checkTopologyDrift,
  configureDockerAuth,
  isPoolRelevant,
  parseServiceFilter,
} from '@tsdevstack/infra-core';
import path from 'node:path';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import type { GCPCommandContext } from './types';

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
 * Deploy services to GCP Cloud Run
 */
export async function gcpDeployServices(
  ctx: GCPCommandContext,
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
      const sqlInstanceName = `${ctx.projectName}-postgres`;
      const discoveryResult = await discoverDeployedServices({
        projectName: ctx.projectName,
        projectId: ctx.credentials.project_id,
        region: ctx.credentials.region,
        sqlInstanceName,
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

  // Separate Docker-based services from SPAs
  const allServices = serviceFilter
    ? config.services.filter((s) => serviceFilter.includes(s.name))
    : config.services.filter(
        (s) => s.type === 'nestjs' || s.type === 'nextjs' || s.type === 'spa',
      );

  if (allServices.length === 0) {
    if (serviceFilter) {
      throw new Error(
        `Service "${options.service}" not found or not deployable`,
      );
    }
    logger.warn('No deployable services found');
    return;
  }

  const dockerServices = allServices.filter(
    (s) => s.type === 'nestjs' || s.type === 'nextjs',
  );
  const spaServices = allServices.filter((s) => s.type === 'spa');

  logger.info(
    `Services to deploy: ${allServices.map((s) => s.name).join(', ')}`,
  );
  logger.newline();

  // Deploy Docker-based services (nestjs, nextjs)
  if (dockerServices.length > 0) {
    const maxParallel = options.maxParallel ?? 2;

    logger.info(
      `Docker services: ${dockerServices.map((s) => s.name).join(', ')}`,
    );
    logger.info(`Parallelism: max ${maxParallel} concurrent operations`);
    logger.newline();

    // Step 1: Generate Dockerfiles (unless skipped) - sequential (fast, no need for parallel)
    if (!options.skipGenerate) {
      logger.info('Step 1/4: Generating Dockerfiles...');
      for (const service of dockerServices) {
        await infraDockerGenerate({ service: service.name });
      }
      logger.newline();
    } else {
      logger.info('Step 1/4: Skipping Dockerfile generation');
      logger.newline();
    }

    // Authenticate Docker once before parallel builds/pushes
    {
      const runtime = buildRuntime();
      const tfEnv = buildGcpTerraformEnv(runtime, ctx.credentials);
      const terraformDir = path.join(
        ctx.projectRoot,
        'infrastructure',
        'terraform',
        targetEnv,
      );
      const registryUrl = getTerraformOutput(
        terraformDir,
        'artifact_registry_url',
        tfEnv,
      );
      const registryHost = registryUrl.split('/')[0];
      logger.info(`Authenticating Docker with ${registryHost}...`);
      await configureDockerAuth(ctx.credentials, registryHost);
    }

    // Step 2: Build Docker images (parallel with limit)
    logger.info(
      `Step 2/4: Building Docker images (max ${maxParallel} parallel)...`,
    );
    await pMap(
      dockerServices,
      async (service) => {
        await infraDockerBuild({
          env: targetEnv,
          service: service.name,
          tag: options.tag,
          maxParallel: 1,
          skipAuth: true,
        });
      },
      { concurrency: maxParallel },
    );
    logger.newline();

    // Step 3: Push Docker images (parallel with limit)
    logger.info(
      `Step 3/4: Pushing Docker images (max ${maxParallel} parallel)...`,
    );
    {
      let pushCompleted = 0;
      const pushTotal = dockerServices.length;
      await pMap(
        dockerServices,
        async (service) => {
          logger.info(
            `  ⏳ Pushing ${service.name}... (${pushCompleted}/${pushTotal} done)`,
          );
          await infraDockerPush({
            env: targetEnv,
            service: service.name,
            tag: options.tag,
            skipAuth: true,
          });
          pushCompleted++;
          logger.success(
            `  ✓ ${service.name} pushed (${pushCompleted}/${pushTotal})`,
          );
        },
        { concurrency: maxParallel },
      );
    }
    logger.newline();

    // Find workers that will be deployed alongside their base services
    const allWorkers = config.services.filter(
      (s) => s.type === 'worker' && s.baseService,
    );

    // Build a map of base service -> workers
    const workersByBaseService = new Map<string, typeof allWorkers>();
    for (const worker of allWorkers) {
      const baseServiceName = worker.baseService!;
      // Only include workers whose base service is being deployed
      if (dockerServices.some((s) => s.name === baseServiceName)) {
        const existing = workersByBaseService.get(baseServiceName) ?? [];
        existing.push(worker);
        workersByBaseService.set(baseServiceName, existing);
      }
    }

    // Log workers that will be deployed
    const workersToDeployCount = Array.from(
      workersByBaseService.values(),
    ).flat().length;
    if (workersToDeployCount > 0) {
      const workerNames = Array.from(workersByBaseService.values())
        .flat()
        .map((w) => w.name);
      logger.info(`Workers (coupled): ${workerNames.join(', ')}`);
      logger.newline();
    }

    // Step 4: Deploy services and workers to Cloud Run (parallel with limit)
    const stepLabel =
      workersToDeployCount > 0 ? 'Deploying services + workers' : 'Deploying';
    logger.info(
      `Step 4/4: ${stepLabel} to Cloud Run (max ${maxParallel} parallel)...`,
    );
    logger.newline();

    {
      let deployCompleted = 0;
      const deployTotal = dockerServices.length + workersToDeployCount;
      await pMap(
        dockerServices,
        async (service) => {
          // Deploy the base service
          logger.info(
            `  ⏳ Deploying ${service.name}... (${deployCompleted}/${deployTotal} done)`,
          );
          // Run migrations if service has a database
          if (service.hasDatabase) {
            await infraDbMigrateRun({
              env: targetEnv,
              service: service.name,
              tag: options.tag,
            });
          }

          // Deploy to Cloud Run
          await gcpDeployService({
            projectRoot: ctx.projectRoot,
            projectName: ctx.projectName,
            targetEnv,
            credentials: ctx.credentials,
            service,
            tag: options.tag,
          });
          deployCompleted++;
          logger.success(
            `  ✓ ${service.name} deployed (${deployCompleted}/${deployTotal})`,
          );

          // Deploy any workers coupled to this service
          const coupledWorkers = workersByBaseService.get(service.name) ?? [];
          for (const worker of coupledWorkers) {
            logger.info(
              `  ⏳ Deploying worker ${worker.name}... (${deployCompleted}/${deployTotal} done)`,
            );
            await infraWorkerDeploy({
              env: targetEnv,
              worker: worker.name,
              baseService: service.name,
              tag: options.tag,
            });
            deployCompleted++;
            logger.success(
              `  ✓ ${worker.name} deployed (${deployCompleted}/${deployTotal})`,
            );
          }
        },
        { concurrency: maxParallel },
      );
    }
    logger.newline();
  }

  // Deploy SPA services (build + upload to Cloud Storage)
  if (spaServices.length > 0) {
    const maxParallel = options.maxParallel ?? 2;

    logger.info(`SPA services: ${spaServices.map((s) => s.name).join(', ')}`);
    logger.newline();

    await pMap(
      spaServices,
      async (service) => {
        logger.info(`Deploying SPA ${service.name}...`);
        await deploySpaService({
          projectRoot: ctx.projectRoot,
          targetEnv,
          credentials: ctx.credentials,
          service,
        });
      },
      { concurrency: maxParallel },
    );
    logger.newline();
  }

  logger.complete('All services deployed successfully!');
  logger.newline();
}
