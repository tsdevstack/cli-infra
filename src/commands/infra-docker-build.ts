/**
 * infra:build-docker Command
 *
 * Builds Docker images for deployable services.
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import pMap from 'p-map';
import { getContext } from '../context';
import { checkDockerInstalled, getGitSha } from '../utils/docker';
import { hasProjectNpmrc } from '../utils/npm-auth';
import { getTerraformOutput } from '../utils/gcp/terraform';
import {
  buildAwsTerraformEnv,
  buildAzureTerraformEnv,
  buildGcpTerraformEnv,
  configureAcrAuth,
  configureDockerAuth,
  configureEcrAuth,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../utils/build-runtime';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { DEPLOYABLE_SERVICE_TYPES } from '../constants';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from '@tsdevstack/cli/plugin';

interface InfraDockerBuildOptions {
  service?: string;
  env?: string;
  tag?: string;
  parallel?: boolean;
  maxParallel?: number;
  /** Skip Docker auth — used when the caller already authenticated (e.g. parallel builds) */
  skipAuth?: boolean;
}

/**
 * Build Docker images for services
 */
export async function infraDockerBuild(
  options: InfraDockerBuildOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info('Building Docker images...');
  logger.newline();

  // Check prerequisites
  checkDockerInstalled();

  // Set up command context (handles credentials, environment resolution)
  const ctx = await setupInfraCommand(options, 'infra:build-docker');
  const { projectRoot, targetEnv, provider } = ctx;

  const config = loadFrameworkConfig();
  const dockerDir = path.join(projectRoot, 'infrastructure', 'docker');

  // Get registry URL from terraform outputs (provider-specific)
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'infra:build-docker',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Build Terraform environment and get registry URL (provider-specific)
  let registryUrl: string;
  let registryHost: string;

  if (provider === 'gcp') {
    const credentials = ctx.credentials as GCPCredentials;
    const runtime = buildRuntime();
    const tfEnv = buildGcpTerraformEnv(runtime, credentials);

    try {
      registryUrl = getTerraformOutput(
        terraformDir,
        'artifact_registry_url',
        tfEnv,
      );
    } catch {
      throw new CliError(
        'Failed to get artifact_registry_url from Terraform outputs',
        'infra:build-docker',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    // Authenticate Docker with Artifact Registry (required for BuildKit cache push)
    registryHost = registryUrl.split('/')[0];
    if (!options.skipAuth) {
      logger.info(`Authenticating Docker with ${registryHost}...`);
      await configureDockerAuth(credentials, registryHost);
    }
  } else if (provider === 'aws') {
    const credentials = ctx.credentials as AWSCredentials;
    const runtime = buildRuntime();
    const tfEnv = buildAwsTerraformEnv(runtime, credentials);

    try {
      registryUrl = getTerraformOutput(
        terraformDir,
        'ecr_repository_url',
        tfEnv,
      );
    } catch {
      throw new CliError(
        'Failed to get ecr_repository_url from Terraform outputs',
        'infra:build-docker',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    // Authenticate Docker with ECR (required for BuildKit cache push)
    registryHost = registryUrl.split('/')[0];
    if (!options.skipAuth) {
      logger.info(`Authenticating Docker with ECR (${registryHost})...`);
      await configureEcrAuth(runtime, credentials, registryUrl);
    }
  } else if (provider === 'azure') {
    const credentials = ctx.credentials as AzureCredentials;
    const runtime = buildRuntime();
    const tfEnv = buildAzureTerraformEnv(runtime, credentials);

    try {
      registryUrl = getTerraformOutput(terraformDir, 'acr_login_server', tfEnv);
    } catch {
      throw new CliError(
        'Failed to get acr_login_server from Terraform outputs',
        'infra:build-docker',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    // Authenticate Docker with ACR (required for BuildKit cache push)
    registryHost = registryUrl;
    if (!options.skipAuth) {
      logger.info(`Authenticating Docker with ACR (${registryHost})...`);
      await configureAcrAuth(runtime, credentials, registryUrl);
    }
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:build-docker',
      'Supported providers: gcp, aws, azure',
    );
  }

  // Get tag (custom or git SHA)
  const gitSha = options.tag ?? getGitSha();

  // Get deployable services
  let services = config.services.filter((s) =>
    (DEPLOYABLE_SERVICE_TYPES as readonly string[]).includes(s.type),
  );

  // Filter by specific service if provided
  if (options.service) {
    services = services.filter((s) => s.name === options.service);

    if (services.length === 0) {
      const allServices = config.services.filter((s) =>
        (DEPLOYABLE_SERVICE_TYPES as readonly string[]).includes(s.type),
      );
      throw new CliError(
        `Service "${options.service}" not found or not deployable`,
        'infra:build-docker',
        `Deployable services: ${allServices.map((s) => s.name).join(', ')}`,
      );
    }
  }

  if (services.length === 0) {
    logger.warn('No deployable services found (nestjs or nextjs types)');
    return;
  }

  // Check Dockerfiles exist
  for (const service of services) {
    const dockerfilePath = path.join(dockerDir, `${service.name}.Dockerfile`);
    if (!fs.existsSync(dockerfilePath)) {
      throw new CliError(
        `Dockerfile not found: ${dockerfilePath}`,
        'infra:build-docker',
        'Run npx tsdevstack infra:generate-docker first',
      );
    }
  }

  // Default to parallel builds (faster)
  const useParallel = options.parallel !== false;
  const maxParallel = options.maxParallel ?? 2;

  // Auto-detect: if `.npmrc` exists at project root, thread `NPM_TOKEN`
  // through to docker build via a BuildKit env-source secret. The
  // generated Dockerfiles emit a matching `--mount=type=secret,id=npm_token,env=NPM_TOKEN`
  // on `npm ci` when the same condition holds (see infra-docker-generate).
  // BuildKit reads the value from this process's env at build time —
  // process.env propagates to the spawned docker subprocess automatically.
  // If `.npmrc` is present but `NPM_TOKEN` is unset, BuildKit fails fast
  // with a clear error.
  const npmAuthEnvSecret = hasProjectNpmrc(projectRoot);

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Git SHA: ${gitSha}`);
  logger.info(`Registry: ${registryUrl}`);
  logger.info(`Services: ${services.map((s) => s.name).join(', ')}`);
  logger.info(
    `Mode: ${useParallel ? `parallel (max ${maxParallel})` : 'sequential'}`,
  );
  logger.info('BuildKit: enabled with registry cache');
  if (npmAuthEnvSecret) {
    logger.info('Private npm auth: NPM_TOKEN forwarded as build secret');
  }
  logger.newline();

  const builtImages: string[] = [];

  // Helper to build a single service with BuildKit caching
  const buildService = (service: {
    name: string;
  }): Promise<{
    service: string;
    imageTag: string;
    success: boolean;
    error?: string;
  }> => {
    const dockerfilePath = path.join(dockerDir, `${service.name}.Dockerfile`);
    const imageTag = `${registryUrl}/${service.name}:${gitSha}`;
    const cacheTag = `${registryUrl}/${service.name}:cache`;

    return new Promise((resolve) => {
      // BuildKit with registry caching for faster subsequent builds
      // ECR requires oci-mediatypes=true,image-manifest=true for cache export
      const cacheTo =
        provider === 'aws'
          ? `type=registry,ref=${cacheTag},mode=max,oci-mediatypes=true,image-manifest=true`
          : `type=registry,ref=${cacheTag},mode=max`;
      const buildArgs = [
        'build',
        '--platform',
        'linux/amd64',
        '--cache-from',
        `type=registry,ref=${cacheTag}`,
        '--cache-to',
        cacheTo,
        '-f',
        dockerfilePath,
        '-t',
        imageTag,
      ];
      if (npmAuthEnvSecret) {
        buildArgs.push('--secret', 'id=npm_token,env=NPM_TOKEN');
      }
      buildArgs.push('.');
      const child = spawn('docker', buildArgs, {
        cwd: projectRoot,
        stdio: 'pipe',
        env: { ...process.env, DOCKER_BUILDKIT: '1' },
      });

      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ service: service.name, imageTag, success: true });
        } else {
          resolve({
            service: service.name,
            imageTag,
            success: false,
            error: stderr.slice(-500),
          });
        }
      });

      child.on('error', (err) => {
        resolve({
          service: service.name,
          imageTag,
          success: false,
          error: err.message,
        });
      });
    });
  };

  if (useParallel && services.length > 1) {
    // Parallel builds with concurrency limit
    logger.generating(
      `Building ${services.length} images in parallel (max ${maxParallel})...`,
    );
    logger.newline();

    // Track progress
    let completed = 0;
    const total = services.length;
    const inProgress = new Set<string>();

    const results = await pMap(
      services,
      async (service) => {
        inProgress.add(service.name);
        logger.building(
          `  Starting ${service.name}... (${completed}/${total} done, ${inProgress.size} in progress)`,
        );

        const result = await buildService(service);

        inProgress.delete(service.name);
        completed++;

        if (result.success) {
          logger.success(`  ${service.name} complete (${completed}/${total})`);
        } else {
          logger.error(`  ${service.name} failed (${completed}/${total})`);
        }

        return result;
      },
      { concurrency: maxParallel },
    );

    logger.newline();
    logger.info('Build summary:');

    // Report results
    const failures: Array<{ service: string; error?: string }> = [];
    for (const result of results) {
      if (result.success) {
        builtImages.push(result.imageTag);
        logger.success(`  ${result.service}`);
      } else {
        failures.push({ service: result.service, error: result.error });
        logger.error(`  ${result.service}`);
      }
    }

    if (failures.length > 0) {
      logger.newline();
      for (const failure of failures) {
        logger.error(`${failure.service} error: ${failure.error}`);
      }
      throw new CliError(
        `Failed to build ${failures.length} service(s): ${failures.map((f) => f.service).join(', ')}`,
        'infra:build-docker',
        'Run with --no-parallel to see detailed output',
      );
    }
  } else {
    // Sequential builds - useful for debugging (with BuildKit caching)
    for (const service of services) {
      const dockerfilePath = path.join(dockerDir, `${service.name}.Dockerfile`);
      const imageTag = `${registryUrl}/${service.name}:${gitSha}`;
      const cacheTag = `${registryUrl}/${service.name}:cache`;

      logger.generating(`Building ${service.name}...`);

      // ECR requires oci-mediatypes=true,image-manifest=true for cache export
      const seqCacheTo =
        provider === 'aws'
          ? `type=registry,ref=${cacheTag},mode=max,oci-mediatypes=true,image-manifest=true`
          : `type=registry,ref=${cacheTag},mode=max`;

      const npmAuthFlag = npmAuthEnvSecret
        ? ' --secret id=npm_token,env=NPM_TOKEN'
        : '';

      try {
        execSync(
          `docker build --platform linux/amd64 ` +
            `--cache-from type=registry,ref=${cacheTag} ` +
            `--cache-to ${seqCacheTo}${npmAuthFlag} ` +
            `-f ${dockerfilePath} -t ${imageTag} .`,
          {
            cwd: projectRoot,
            stdio: 'inherit',
            env: { ...process.env, DOCKER_BUILDKIT: '1' },
          },
        );

        builtImages.push(imageTag);
        logger.success(`  ${service.name} → ${imageTag}`);
      } catch {
        throw new CliError(
          `Failed to build ${service.name}`,
          'infra:build-docker',
          'Check the Docker output above for details',
        );
      }
    }
  }

  logger.newline();
  logger.complete(`Built ${builtImages.length} image(s)!`);
  logger.newline();
  logger.info('Next steps:');
  logger.info('  npx tsdevstack infra:push-docker');
  logger.newline();
}
