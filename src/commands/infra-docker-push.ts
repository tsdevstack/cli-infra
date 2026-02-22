/**
 * infra:push-docker Command
 *
 * Pushes Docker images to container registries (Artifact Registry or ECR).
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { getContext } from '../context';
import { checkDockerInstalled, getGitSha } from '../utils/docker';
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
} from 'tsdevstack/plugin';

interface InfraDockerPushOptions {
  service?: string;
  env?: string;
  tag?: string;
  parallel?: boolean;
  /** Skip Docker auth — used when the caller already authenticated (e.g. parallel pushes) */
  skipAuth?: boolean;
}

/**
 * Push Docker images to Artifact Registry
 */
export async function infraDockerPush(
  options: InfraDockerPushOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info('Pushing Docker images to container registry...');
  logger.newline();

  // Check prerequisites
  checkDockerInstalled();

  // Set up command context (handles credentials, environment resolution)
  const ctx = await setupInfraCommand(options, 'infra:push-docker');
  const { projectRoot, targetEnv, provider } = ctx;

  const config = loadFrameworkConfig();

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
      'infra:push-docker',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Build Terraform environment and get registry URL (provider-specific)
  let registryUrl: string;

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
        'infra:push-docker',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    // Configure Docker authentication for Artifact Registry
    const registryHost = `${credentials.region}-docker.pkg.dev`;
    if (!options.skipAuth) {
      logger.info(`Configuring Docker authentication for ${registryHost}...`);
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
        'infra:push-docker',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    // Configure Docker authentication for ECR
    const registryHost = registryUrl.split('/')[0];
    if (!options.skipAuth) {
      logger.info(
        `Configuring Docker authentication for ECR (${registryHost})...`,
      );
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
        'infra:push-docker',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    // Configure Docker authentication for ACR
    const registryHost = registryUrl;
    if (!options.skipAuth) {
      logger.info(
        `Configuring Docker authentication for ACR (${registryHost})...`,
      );
      await configureAcrAuth(runtime, credentials, registryUrl);
    }
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:push-docker',
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
        'infra:push-docker',
        `Deployable services: ${allServices.map((s) => s.name).join(', ')}`,
      );
    }
  }

  if (services.length === 0) {
    logger.warn('No deployable services found (nestjs or nextjs types)');
    return;
  }

  // Default to parallel pushes (faster)
  const useParallel = options.parallel !== false;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Git SHA: ${gitSha}`);
  logger.info(`Registry: ${registryUrl}`);
  logger.info(`Services: ${services.map((s) => s.name).join(', ')}`);
  logger.info(`Mode: ${useParallel ? 'parallel' : 'sequential'}`);
  logger.newline();

  const pushedImages: string[] = [];

  /**
   * Push a single image using spawn (for parallel execution)
   */
  const pushImage = (
    imageTag: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const child = spawn('docker', ['push', imageTag], {
        cwd: projectRoot,
        stdio: 'pipe',
      });

      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr.slice(-500) });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  };

  if (useParallel && services.length > 1) {
    // Parallel pushes - significantly faster
    logger.generating(`Pushing ${services.length} services in parallel...`);
    logger.newline();

    const pushPromises = services.map(async (service) => {
      const imageTag = `${registryUrl}/${service.name}:${gitSha}`;
      const latestTag = `${registryUrl}/${service.name}:latest`;

      // Tag as latest first (sync, fast)
      try {
        execSync(`docker tag ${imageTag} ${latestTag}`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      } catch {
        return {
          service: service.name,
          success: false,
          error: 'Failed to tag as latest',
        };
      }

      // Push both tags in parallel
      const [shaResult, latestResult] = await Promise.all([
        pushImage(imageTag),
        pushImage(latestTag),
      ]);

      if (shaResult.success && latestResult.success) {
        return { service: service.name, imageTag, success: true };
      } else {
        return {
          service: service.name,
          imageTag,
          success: false,
          error: shaResult.error || latestResult.error,
        };
      }
    });

    const results = await Promise.all(pushPromises);

    // Report results
    const failures: Array<{ service: string; error?: string }> = [];
    for (const result of results) {
      if (result.success) {
        pushedImages.push(result.imageTag!);
        logger.success(`  ✓ ${result.service}`);
      } else {
        failures.push({ service: result.service, error: result.error });
        logger.error(`  ✗ ${result.service}`);
      }
    }

    if (failures.length > 0) {
      logger.newline();
      for (const failure of failures) {
        logger.error(`${failure.service} error: ${failure.error}`);
      }
      throw new CliError(
        `Failed to push ${failures.length} service(s): ${failures.map((f) => f.service).join(', ')}`,
        'infra:push-docker',
        'Run with --no-parallel to see detailed output',
      );
    }
  } else {
    // Sequential pushes - useful for debugging
    for (const service of services) {
      const imageTag = `${registryUrl}/${service.name}:${gitSha}`;
      const latestTag = `${registryUrl}/${service.name}:latest`;

      logger.generating(`Pushing ${service.name}...`);

      try {
        // Push SHA-tagged image
        execSync(`docker push ${imageTag}`, {
          cwd: projectRoot,
          stdio: 'inherit',
        });

        // Tag as latest
        execSync(`docker tag ${imageTag} ${latestTag}`, {
          cwd: projectRoot,
          stdio: 'inherit',
        });

        // Push latest
        execSync(`docker push ${latestTag}`, {
          cwd: projectRoot,
          stdio: 'inherit',
        });

        pushedImages.push(imageTag);
        logger.success(`  ✓ ${service.name} → ${imageTag}`);
        logger.success(`  ✓ ${service.name} → ${latestTag}`);
      } catch {
        throw new CliError(
          `Failed to push ${service.name}`,
          'infra:push-docker',
          'Check the Docker output above for details',
        );
      }
    }
  }

  logger.newline();
  logger.complete(`Pushed ${pushedImages.length} image(s)!`);
  logger.newline();
  logger.info('Next steps:');
  logger.info(
    '  npx tsdevstack infra:deploy-services --env <env> --service <service>',
  );
  logger.newline();
}
