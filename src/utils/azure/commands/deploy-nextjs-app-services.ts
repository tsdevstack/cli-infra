/**
 * Deploy Next.js App Services
 *
 * Deploys Next.js services to Azure App Service.
 * Docker build → push to ACR → deploy to App Service.
 */

import path from 'node:path';
import pMap from 'p-map';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import { deployAppService } from './deploy-app-service';
import { setAppServiceSettings } from './set-app-service-settings';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { getGitSha } from '../../docker';
import { fetchSecret } from '../../credentials/fetch-secret';
import {
  buildAzureTerraformEnv,
  buildFrontendEnvVars,
  buildFrontendSecrets,
  configureAcrAuth,
  parseServiceFilter,
} from '@tsdevstack/infra-core';
import { getServiceSecretKeys } from '../../deploy/get-service-secret-keys';
import { toTerraformId } from '../../terraform';
import type { AzureCommandContext } from './types';

interface DeployNextjsAppServicesOptions {
  service?: string;
  tag?: string;
  skipGenerate?: boolean;
  maxParallel?: number;
}

export async function deployNextjsAppServices(
  ctx: AzureCommandContext,
  options: DeployNextjsAppServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError, buildSecretName } =
    getContext();
  const runtime = buildRuntime();
  const { projectRoot, targetEnv, credentials } = ctx;

  const config = loadFrameworkConfig();
  const tfEnv = buildAzureTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  // Get required Terraform outputs
  let acrLoginServer: string;
  let resourceGroupName: string;

  try {
    acrLoginServer = getTerraformOutput(
      terraformDir,
      'acr_login_server',
      tfEnv,
    );
    resourceGroupName = getTerraformOutput(
      terraformDir,
      'resource_group_name',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:deploy-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Get Next.js services
  let services = config.services.filter((s) => s.type === 'nextjs');

  const serviceFilter = parseServiceFilter(options.service);
  if (serviceFilter) {
    services = services.filter((s) => serviceFilter.includes(s.name));
  }

  if (services.length === 0) {
    logger.warn('No Next.js services found to deploy');
    return;
  }

  const imageTag = options.tag ?? getGitSha();

  // Step 1: Generate Dockerfiles (unless skipped)
  if (!options.skipGenerate) {
    logger.info('Step 1/4: Generating Dockerfiles...');
    for (const service of services) {
      await infraDockerGenerate({ service: service.name });
    }
    logger.newline();
  } else {
    logger.info('Step 1/4: Skipping Dockerfile generation');
    logger.newline();
  }

  // Authenticate Docker with ACR once before parallel builds/pushes
  const maxParallel = options.maxParallel ?? 2;
  logger.info(`Authenticating Docker with ACR (${acrLoginServer})...`);
  await configureAcrAuth(runtime, credentials, acrLoginServer);

  // Step 2: Build Docker images (parallel with limit)
  logger.info(
    `Step 2/4: Building Docker images (max ${maxParallel} parallel)...`,
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

  // Step 3: Push Docker images (parallel with limit)
  logger.info(
    `Step 3/4: Pushing Docker images (max ${maxParallel} parallel)...`,
  );
  {
    let pushCompleted = 0;
    const pushTotal = services.length;
    await pMap(
      services,
      async (service) => {
        logger.info(
          `  ⏳ Pushing ${service.name}... (${pushCompleted}/${pushTotal} done)`,
        );
        await infraDockerPush({
          env: targetEnv,
          service: service.name,
          tag: imageTag,
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

  // Step 4: Deploy to App Service
  logger.info('Step 4/4: Deploying to App Service...');

  for (const service of services) {
    const tfId = toTerraformId(service.name);
    const imageUri = `${acrLoginServer}/${service.name}:${imageTag}`;

    // Get App Service name from Terraform output
    let appServiceName: string;
    try {
      appServiceName = getTerraformOutput(
        terraformDir,
        `nextjs_${tfId}_app_service_name`,
        tfEnv,
      );
    } catch {
      throw new CliError(
        `Failed to get App Service name for ${service.name}`,
        'infra:deploy-services',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    logger.newline();
    logger.info(`Deploying ${service.name} to App Service...`);
    logger.info(`  Image: ${imageUri}`);
    logger.info(`  App Service: ${appServiceName}`);

    // Build settings from frontend env vars + secrets
    const settings: Record<string, string> = {};

    // Standard frontend env vars
    const standardEnvVars = buildFrontendEnvVars();
    for (const [name, value] of Object.entries(standardEnvVars)) {
      settings[name] = String(value);
    }

    // Frontend secrets — scoped to what this service references
    const frontendKeys = getServiceSecretKeys(service.name, config);
    const frontendSecretConfigs = buildFrontendSecrets(
      ctx.projectName,
      buildSecretName,
      frontendKeys,
    );
    for (const secretConfig of frontendSecretConfigs) {
      const value = fetchSecret(secretConfig.envVar, targetEnv);
      if (value) {
        settings[secretConfig.envVar] = value;
        logger.info(`  Injecting ${secretConfig.envVar}`);
      } else {
        logger.warn(`  ${secretConfig.envVar} not found in Key Vault`);
      }
    }

    // Ensure API_URL is set — fall back to Terraform api_url output
    if (!settings['API_URL']) {
      try {
        const apiUrl = getTerraformOutput(terraformDir, 'api_url', tfEnv);
        settings['API_URL'] = apiUrl;
        logger.info(`  Injecting API_URL from Terraform: ${apiUrl}`);
      } catch {
        logger.warn('  API_URL not found in Key Vault or Terraform outputs');
      }
    }

    // Set app settings
    if (Object.keys(settings).length > 0) {
      await setAppServiceSettings(
        credentials,
        resourceGroupName,
        appServiceName,
        settings,
      );
    }

    // Deploy container image
    await deployAppService({
      credentials,
      resourceGroupName,
      appServiceName,
      acrLoginServer,
      imageUri,
    });

    logger.success(`  ${service.name} deployed to App Service`);
  }
}
