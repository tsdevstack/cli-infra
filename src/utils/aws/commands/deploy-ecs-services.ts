/**
 * Deploy ECS Services
 *
 * Orchestrates the complete ECS service deployment workflow:
 * 1. Generate Dockerfiles
 * 2. Build Docker images
 * 3. Push images to ECR
 * 4. Update ECS services (force new deployment)
 *
 * Similar to GCP's infra-deploy-services but for AWS ECS.
 */

import path from 'node:path';
import fs from 'node:fs';
import pMap from 'p-map';
import { getContext } from '../../../context';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { checkDockerInstalled, getGitSha } from '../../docker';
import { getTerraformOutput } from '../terraform';
import { awsDeployWorker } from './deploy-worker';

import { awsDbMigrateRun } from './db-migrate-run';
import {
  buildAwsTerraformEnv,
  configureEcrAuth,
  deployEcsServiceWithSecrets,
  waitForEcsStable,
  parseServiceFilter,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCommandContext } from './types';

export interface DeployEcsServicesOptions {
  /** Specific service to deploy (optional, deploys all if not specified) */
  service?: string;
  /** Custom image tag (defaults to git SHA) */
  tag?: string;
  /** Skip Dockerfile generation */
  skipGenerate?: boolean;
  /** Max parallel operations (default: 2) */
  maxParallel?: number;
  /** Skip waiting for services to stabilize */
  skipWait?: boolean;
}

/**
 * Deploy services to ECS
 */
export async function deployEcsServices(
  ctx: AWSCommandContext,
  options: DeployEcsServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info('Deploying services to ECS...');
  logger.newline();

  checkDockerInstalled();

  const config = loadFrameworkConfig();
  const { projectRoot, projectName, targetEnv, credentials } = ctx;

  // Validate terraform directory exists
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'deploy-ecs-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Build Terraform environment
  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);

  // Get ECR URL and cluster name from Terraform outputs
  let ecrUrl: string;
  let clusterName: string;

  try {
    ecrUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
    clusterName = getTerraformOutput(terraformDir, 'ecs_cluster_name', tfEnv);
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      'deploy-ecs-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Get NestJS services only (Next.js is deployed by deploy-nextjs-services)
  let services = config.services.filter((s) => s.type === 'nestjs');

  // Filter by specific service(s) if provided
  const serviceFilter = parseServiceFilter(options.service);
  if (serviceFilter) {
    services = services.filter((s) => serviceFilter.includes(s.name));

    if (services.length === 0) {
      const allNestjsServices = config.services.filter(
        (s) => s.type === 'nestjs',
      );
      throw new CliError(
        `Service "${options.service}" not found or not a NestJS service`,
        'deploy-ecs-services',
        allNestjsServices.length > 0
          ? `NestJS services: ${allNestjsServices.map((s) => s.name).join(', ')}`
          : 'No NestJS services found in this project',
      );
    }
  }

  if (services.length === 0) {
    logger.warn('No NestJS services found');
    return;
  }

  const maxParallel = options.maxParallel ?? 2;
  const imageTag = options.tag ?? getGitSha();

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`ECR: ${ecrUrl}`);
  logger.info(`ECS Cluster: ${clusterName}`);
  logger.info(`Image tag: ${imageTag}`);
  logger.info(`Services: ${services.map((s) => s.name).join(', ')}`);
  logger.info(`Parallelism: max ${maxParallel} concurrent operations`);
  logger.newline();

  // Step 1: Generate Dockerfiles
  if (!options.skipGenerate) {
    logger.info('Step 1/6: Generating Dockerfiles...');
    for (const service of services) {
      await infraDockerGenerate({ service: service.name });
    }
    logger.newline();
  } else {
    logger.info('Step 1/6: Skipping Dockerfile generation');
    logger.newline();
  }

  // Authenticate Docker with ECR once before parallel builds/pushes
  logger.info('Authenticating Docker with ECR...');
  await configureEcrAuth(runtime, credentials, ecrUrl);

  // Step 2: Build Docker images
  logger.info(
    `Step 2/6: Building Docker images (max ${maxParallel} parallel)...`,
  );
  await pMap(
    services,
    async (service) => {
      await infraDockerBuild({
        env: targetEnv,
        service: service.name,
        tag: imageTag,
        maxParallel: 1,
        skipAuth: true,
      });
    },
    { concurrency: maxParallel },
  );
  logger.newline();

  // Step 3: Push to ECR (uses provider-agnostic infraDockerPush)
  logger.info(`Step 3/6: Pushing to ECR (max ${maxParallel} parallel)...`);
  await pMap(
    services,
    async (service) => {
      await infraDockerPush({
        env: targetEnv,
        service: service.name,
        tag: imageTag,
        skipAuth: true,
      });
    },
    { concurrency: maxParallel },
  );
  logger.newline();

  // Step 4: Run migrations for services with databases
  const servicesWithDb = services.filter((s) => s.hasDatabase);
  if (servicesWithDb.length > 0) {
    logger.info(
      `Step 4/6: Running database migrations for ${servicesWithDb.length} service(s)...`,
    );

    for (const service of servicesWithDb) {
      logger.info(`  Running migrations for ${service.name}...`);
      await awsDbMigrateRun({
        projectRoot,
        targetEnv,
        projectName,
        credentials,
        service,
        imageTag,
      });
      logger.success(`  ✓ ${service.name} migrations complete`);
    }
    logger.newline();
  }

  // Step 5: Update ECS services with secrets injection
  logger.info(
    `Step 5/6: Updating ECS services with secrets (max ${maxParallel} parallel)...`,
  );

  const updateFailures: Array<{ service: string; error?: string }> = [];

  await pMap(
    services,
    async (service) => {
      // Build full image URI
      const imageUri = `${ecrUrl}/${service.name}:${imageTag}`;

      // Deploy with secrets injection (same approach as deploy-kong.ts)
      try {
        await deployEcsServiceWithSecrets(runtime, {
          credentials,
          projectName,
          clusterName,
          serviceName: service.name,
          imageUri,
          hasDatabase: service.hasDatabase ?? false,
        });

        logger.success(`  ✓ ${service.name} deployment triggered`);

        // Optionally wait for service to stabilize
        if (!options.skipWait) {
          try {
            const waitResult = await waitForEcsStable(runtime, {
              credentials,
              clusterName,
              serviceName: service.name,
              timeoutMs: 300000, // 5 minutes
              onStatusUpdate: (status) => logger.info(`    ${status}`),
            });

            logger.success(
              `  ✓ ${service.name} stable (${waitResult.runningCount}/${waitResult.desiredCount})`,
            );
          } catch (err) {
            logger.warn(
              `  ⚠ ${service.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        updateFailures.push({ service: service.name, error: msg });
        logger.error(`  ✗ ${service.name}: ${msg}`);
      }
    },
    { concurrency: maxParallel },
  );

  if (updateFailures.length > 0) {
    throw new CliError(
      `Failed to update ${updateFailures.length} ECS service(s)`,
      'deploy-ecs-services',
      updateFailures.map((f) => `${f.service}: ${f.error}`).join('\n'),
    );
  }

  logger.newline();

  // Step 5: Deploy workers coupled to the deployed services
  const allWorkers = config.services.filter(
    (s) => s.type === 'worker' && s.baseService,
  );

  // Build a map of base service -> workers
  const workersByBaseService = new Map<
    string,
    Array<(typeof config.services)[number]>
  >();
  for (const worker of allWorkers) {
    const baseServiceName = worker.baseService!;
    // Only include workers whose base service is being deployed
    if (services.some((s) => s.name === baseServiceName)) {
      const existing = workersByBaseService.get(baseServiceName) ?? [];
      existing.push(worker);
      workersByBaseService.set(baseServiceName, existing);
    }
  }

  const workersToDeployCount = Array.from(workersByBaseService.values()).flat()
    .length;

  if (workersToDeployCount > 0) {
    logger.info(
      `Step 6/6: Deploying ${workersToDeployCount} worker(s) to ECS...`,
    );

    const workerFailures: Array<{ worker: string; error?: string }> = [];

    for (const service of services) {
      const coupledWorkers = workersByBaseService.get(service.name) ?? [];
      const baseService = config.services.find((s) => s.name === service.name);

      if (!baseService) continue;

      for (const worker of coupledWorkers) {
        try {
          await awsDeployWorker({
            projectRoot,
            projectName,
            targetEnv,
            credentials,
            worker,
            baseService,
            imageTag: imageTag,
          });
          logger.success(`  ✓ ${worker.name} deployed`);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error';
          workerFailures.push({ worker: worker.name, error: errorMsg });
          logger.error(`  ✗ ${worker.name}: ${errorMsg}`);
        }
      }
    }

    if (workerFailures.length > 0) {
      throw new CliError(
        `Failed to deploy ${workerFailures.length} worker(s)`,
        'deploy-ecs-services',
        workerFailures.map((f) => `${f.worker}: ${f.error}`).join('\n'),
      );
    }

    logger.newline();
  }

  logger.complete(
    `All ${services.length} service(s)${workersToDeployCount > 0 ? ` and ${workersToDeployCount} worker(s)` : ''} deployed successfully!`,
  );
  logger.newline();
}
