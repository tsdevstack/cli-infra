/**
 * Deploy App Runner Services (Next.js)
 *
 * Orchestrates the complete App Runner service deployment workflow:
 * 1. Load infrastructure config (for CPU/memory overrides)
 * 2. Generate Dockerfiles
 * 3. Build Docker images
 * 4. Push images to ECR
 * 5. Create/update App Runner services
 * 6. Wait for services to reach RUNNING status
 *
 * Follows the GCP Cloud Run pattern (CLI creates/updates services with config),
 * NOT the ECS pattern (Terraform creates task definitions).
 */

import path from 'node:path';
import fs from 'node:fs';
import pMap from 'p-map';
import { getContext } from '../../../context';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { checkDockerInstalled, getGitSha } from '../../docker';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { buildAppRunnerSecretsMap } from '../apprunner';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/get-service-config';
import type { EnvironmentOverrides } from '../../infrastructure/types';
import {
  buildAwsTerraformEnv,
  buildFrontendEnvVars,
  configureEcrAuth,
  createOrUpdateAppRunnerService,
  parseServiceFilter,
  waitForAppRunnerRunning,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { getServiceSecretKeys } from '../../deploy/get-service-secret-keys';
import { parseCpuToNumber } from './parse-cpu-to-number';
import { parseMemoryToNumber } from './parse-memory-to-number';
import type { AWSCommandContext } from './types';

/** App Runner defaults (smallest config) - same as generate-terraform-files.ts */
const APP_RUNNER_DEFAULTS = {
  cpu: 256,
  memory: 512,
} as const;

export interface DeployAppRunnerServicesOptions {
  /** Specific service to deploy (optional, deploys all Next.js services if not specified) */
  service?: string;
  /** Custom image tag (defaults to git SHA) */
  tag?: string;
  /** Skip Dockerfile generation */
  skipGenerate?: boolean;
  /** Max parallel operations (default: 2) */
  maxParallel?: number;
  /** Skip waiting for services to reach RUNNING status */
  skipWait?: boolean;
}

/**
 * Deploy Next.js services to App Runner
 */
export async function deployAppRunnerServices(
  ctx: AWSCommandContext,
  options: DeployAppRunnerServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info('Deploying Next.js services to App Runner...');
  logger.newline();

  checkDockerInstalled();

  const frameworkConfig = loadFrameworkConfig();
  const infraConfig = loadInfrastructureConfig();
  const { projectRoot, projectName, targetEnv, credentials } = ctx;

  // Get environment-specific overrides
  const envConfig = infraConfig?.[targetEnv] as
    | EnvironmentOverrides
    | undefined;

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
      'deploy-apprunner-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Build Terraform environment
  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);

  // Get required Terraform outputs
  let ecrUrl: string;
  let accessRoleArn: string;
  let autoScalingArns: Record<string, string>;
  let instanceRoleArn: string;

  try {
    ecrUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
    accessRoleArn = getTerraformOutput(
      terraformDir,
      'apprunner_ecr_access_role_arn',
      tfEnv,
    );
    autoScalingArns = getTerraformOutputJson<Record<string, string>>(
      terraformDir,
      'apprunner_autoscaling_arns',
      tfEnv,
    );
    instanceRoleArn = getTerraformOutput(
      terraformDir,
      'apprunner_instance_role_arn',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      'deploy-apprunner-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Get Next.js services only
  let services = frameworkConfig.services.filter((s) => s.type === 'nextjs');

  // Filter by specific service(s) if provided
  const serviceFilter = parseServiceFilter(options.service);
  if (serviceFilter) {
    services = services.filter((s) => serviceFilter.includes(s.name));

    if (services.length === 0) {
      const allNextjsServices = frameworkConfig.services.filter(
        (s) => s.type === 'nextjs',
      );
      throw new CliError(
        `Service "${options.service}" not found or not a Next.js service`,
        'deploy-apprunner-services',
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

  // Step 3: Push to ECR (uses provider-agnostic infraDockerPush)
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

  // Step 4: Create/update App Runner services
  logger.info(
    `Step 4/5: Creating/updating App Runner services (max ${maxParallel} parallel)...`,
  );

  const deployResults: Array<{
    service: string;
    serviceArn: string;
    created: boolean;
  }> = [];
  const deployFailures: Array<{ service: string; error?: string }> = [];

  await pMap(
    services,
    async (service) => {
      // Construct image URI (matches infraDockerBuild/infraDockerPush format)
      const imageUri = `${ecrUrl}/${service.name}:${imageTag}`;

      // Resolve config (same pattern as generate-terraform-files.ts)
      const resolved = getServiceConfig(
        infraConfig,
        service.name,
        targetEnv,
        'aws',
      );
      const serviceOverride = envConfig?.[service.name] as
        | { cpu?: string; memory?: string }
        | undefined;
      const hasCpuMemoryOverride =
        serviceOverride?.cpu !== undefined ||
        serviceOverride?.memory !== undefined;

      // Determine CPU/memory
      let cpu: number;
      let memory: number;

      if (hasCpuMemoryOverride) {
        cpu = parseCpuToNumber(resolved.cpu);
        memory = parseMemoryToNumber(resolved.memory);
      } else {
        // App Runner defaults (smallest config)
        cpu = APP_RUNNER_DEFAULTS.cpu;
        memory = APP_RUNNER_DEFAULTS.memory;
      }

      // Build service name: {project}-{env}-{service}
      const appRunnerServiceName = `${projectName}-${targetEnv}-${service.name}`;

      // Build environment variables (plaintext, static config)
      const envVars: Record<string, string> = {
        ...buildFrontendEnvVars(),
      };

      // Discover secrets from Secrets Manager (shared + service-scoped)
      // These are resolved at container start time, not baked in at deploy time
      let environmentSecrets: Record<string, string> = {};
      const secretsResult = await buildAppRunnerSecretsMap({
        credentials,
        projectName,
        serviceName: service.name,
      });
      if (
        secretsResult.success &&
        Object.keys(secretsResult.secrets).length > 0
      ) {
        // Filter discovered secrets to only keys this service references
        const allowedKeys = new Set(
          getServiceSecretKeys(service.name, frameworkConfig),
        );
        environmentSecrets = Object.fromEntries(
          Object.entries(secretsResult.secrets).filter(([key]) =>
            allowedKeys.has(key),
          ),
        );
        logger.info(
          `    ${service.name}: ${Object.keys(environmentSecrets).length} secret(s) discovered`,
        );

        // App Runner requires unique keys across env vars and secrets.
        // Secrets take priority — remove plaintext vars that exist as secrets.
        for (const key of Object.keys(environmentSecrets)) {
          if (key in envVars) {
            delete envVars[key];
          }
        }
      }

      try {
        const result = await createOrUpdateAppRunnerService(runtime, {
          credentials,
          serviceName: appRunnerServiceName,
          imageUri,
          accessRoleArn,
          autoScalingConfigArn: autoScalingArns[service.name],
          cpu,
          memory,
          port: 8080, // Match Dockerfile PORT (same as Cloud Run)
          environmentVariables: envVars,
          environmentSecrets,
          instanceRoleArn,
        });

        if (result.serviceArn) {
          deployResults.push({
            service: service.name,
            serviceArn: result.serviceArn,
            created: result.created ?? false,
          });
          const action = result.created ? 'created' : 'updated';
          logger.success(`  ✓ ${service.name} ${action}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        deployFailures.push({ service: service.name, error: msg });
        logger.error(`  ✗ ${service.name}: ${msg}`);
      }
    },
    { concurrency: maxParallel },
  );

  if (deployFailures.length > 0) {
    throw new CliError(
      `Failed to deploy ${deployFailures.length} service(s)`,
      'deploy-apprunner-services',
      deployFailures.map((f) => `${f.service}: ${f.error}`).join('\n'),
    );
  }
  logger.newline();

  // Step 5: Wait for services to be RUNNING
  if (!options.skipWait) {
    logger.info('Step 5/5: Waiting for services to reach RUNNING status...');

    const waitFailures: Array<{ service: string; error?: string }> = [];

    await pMap(
      deployResults,
      async (deployed) => {
        try {
          const waitResult = await waitForAppRunnerRunning(runtime, {
            credentials,
            serviceArn: deployed.serviceArn,
            timeoutMs: 600000, // 10 minutes
            onStatusUpdate: (status) =>
              logger.info(`    ${deployed.service}: ${status}`),
          });

          logger.success(
            `  ✓ ${deployed.service} RUNNING (${waitResult.serviceUrl})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          waitFailures.push({
            service: deployed.service,
            error: msg,
          });
          logger.warn(`  ⚠ ${deployed.service}: ${msg}`);
        }
      },
      { concurrency: maxParallel },
    );

    if (waitFailures.length > 0) {
      logger.warn(
        `${waitFailures.length} service(s) did not reach RUNNING status in time`,
      );
    }
  } else {
    logger.info('Step 5/5: Skipping wait for RUNNING status');
  }

  logger.newline();
  logger.complete(
    `All ${services.length} Next.js service(s) deployed successfully!`,
  );
  logger.newline();
}
