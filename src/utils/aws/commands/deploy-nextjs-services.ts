/**
 * Deploy Next.js Services to ECS
 *
 * Orchestrates the complete Next.js ECS deployment workflow:
 * 1. Generate Dockerfiles
 * 2. Build Docker images
 * 3. Push images to ECR
 * 4. Update ECS services (force new deployment with secrets)
 * 5. Wait for services to stabilize
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
import {
  AWS_NEXTJS_CLIENT_IP_SETTINGS,
  buildAwsTerraformEnv,
  configureEcrAuth,
  deployEcsServiceWithSecrets,
  waitForEcsStable,
  parseServiceFilter,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { getServiceSecretKeys } from '../../deploy/get-service-secret-keys';
import type { AWSCommandContext } from './types';

export interface DeployNextjsServicesOptions {
  /** Specific service to deploy (optional, deploys all Next.js services if not specified) */
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
 * Deploy Next.js services to ECS
 */
export async function deployNextjsServices(
  ctx: AWSCommandContext,
  options: DeployNextjsServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info('Deploying Next.js services to ECS...');
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
      'deploy-nextjs-services',
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
      'deploy-nextjs-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Get Next.js services only
  let services = config.services.filter((s) => s.type === 'nextjs');

  // Filter by specific service(s) if provided
  const serviceFilter = parseServiceFilter(options.service);
  if (serviceFilter) {
    services = services.filter((s) => serviceFilter.includes(s.name));

    if (services.length === 0) {
      const allNextjsServices = config.services.filter(
        (s) => s.type === 'nextjs',
      );
      throw new CliError(
        `Service "${options.service}" not found or not a Next.js service`,
        'deploy-nextjs-services',
        allNextjsServices.length > 0
          ? `Next.js services: ${allNextjsServices.map((s) => s.name).join(', ')}`
          : 'No Next.js services found in this project',
      );
    }
  }

  if (services.length === 0) {
    logger.warn('No Next.js services found');
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
    logger.info('Step 1/5: Generating Dockerfiles...');
    for (const service of services) {
      await infraDockerGenerate({ service: service.name });
    }
    logger.newline();
  } else {
    logger.info('Step 1/5: Skipping Dockerfile generation');
    logger.newline();
  }

  // Authenticate Docker with ECR once before parallel builds/pushes
  logger.info('Authenticating Docker with ECR...');
  await configureEcrAuth(runtime, credentials, ecrUrl);

  // Step 2: Build Docker images
  logger.info(
    `Step 2/5: Building Docker images (max ${maxParallel} parallel)...`,
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

  // Step 3: Push to ECR
  logger.info(`Step 3/5: Pushing to ECR (max ${maxParallel} parallel)...`);
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

  // Step 4: Update ECS services with secrets injection
  logger.info(
    `Step 4/5: Updating ECS services with secrets (max ${maxParallel} parallel)...`,
  );

  const updateFailures: Array<{ service: string; error?: string }> = [];

  // Build secret ARNs for Next.js services
  // Next.js reads env vars directly (not via SecretsService), so we must inject them
  const secretArnPrefix = `arn:aws:secretsmanager:${credentials.region}:${credentials.accountId}:secret`;

  await pMap(
    services,
    async (service) => {
      const imageUri = `${ecrUrl}/${service.name}:${imageTag}`;

      // Discover which secrets this service needs from secret-map.json
      const secretKeys = getServiceSecretKeys(service.name, config);
      const additionalSecrets: Record<string, string> = {};

      for (const key of secretKeys) {
        // Shared secrets use {project}-shared-{KEY} naming
        additionalSecrets[key] =
          `${secretArnPrefix}:${projectName}-shared-${key}`;
      }

      if (Object.keys(additionalSecrets).length > 0) {
        logger.info(
          `    ${service.name}: ${Object.keys(additionalSecrets).length} secret(s): ${Object.keys(additionalSecrets).join(', ')}`,
        );
      }

      try {
        await deployEcsServiceWithSecrets(runtime, {
          credentials,
          projectName,
          clusterName,
          serviceName: service.name,
          imageUri,
          hasDatabase: false,
          additionalSecrets,
          // The visitor's address header (the CloudFront function sets it)
          additionalEnvironment: { ...AWS_NEXTJS_CLIENT_IP_SETTINGS },
        });

        logger.success(`  ✓ ${service.name} deployment triggered`);
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
      'deploy-nextjs-services',
      updateFailures.map((f) => `${f.service}: ${f.error}`).join('\n'),
    );
  }
  logger.newline();

  // Step 5: Wait for services to stabilize
  if (!options.skipWait) {
    logger.info('Step 5/5: Waiting for services to stabilize...');

    await pMap(
      services,
      async (service) => {
        try {
          const waitResult = await waitForEcsStable(runtime, {
            credentials,
            clusterName,
            serviceName: service.name,
            timeoutMs: 300000,
            onStatusUpdate: (status) =>
              logger.info(`    ${service.name}: ${status}`),
          });

          logger.success(
            `  ✓ ${service.name} stable (${waitResult.runningCount}/${waitResult.desiredCount})`,
          );
        } catch (err) {
          logger.warn(
            `  ⚠ ${service.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      },
      { concurrency: maxParallel },
    );
  } else {
    logger.info('Step 5/5: Skipping wait');
  }

  logger.newline();
  logger.complete(
    `All ${services.length} Next.js service(s) deployed successfully!`,
  );
  logger.newline();
}
