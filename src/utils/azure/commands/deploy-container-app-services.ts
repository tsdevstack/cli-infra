/**
 * Deploy Container App Services
 *
 * Deploys NestJS backend services to Azure Container Apps.
 * Next.js services are deployed to App Service (see deploy-nextjs-app-services.ts).
 */

import path from 'node:path';
import pMap from 'p-map';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { getGitSha } from '../../docker';

import { buildAzureBackendEnv } from './build-azure-backend-env';
import {
  buildAzureTerraformEnv,
  calculatePoolSize,
  configureAcrAuth,
  createOrUpdateContainerApp,
  getTotalWorkerMaxInstances,
  parseServiceFilter,
  waitForContainerAppReady,
} from '@tsdevstack/infra-core';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/merge-with-defaults';
import type { EnvironmentOverrides } from '../../infrastructure/types';
import { azureDbMigrateRun } from './db-migrate-run';
import type { AzureCommandContext } from './types';

interface DeployContainerAppServicesOptions {
  service?: string;
  tag?: string;
  skipGenerate?: boolean;
  maxParallel?: number;
}

export async function deployContainerAppServices(
  ctx: AzureCommandContext,
  options: DeployContainerAppServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError, DEFAULT_AZURE_DATABASE_TIER } =
    getContext();
  const runtime = buildRuntime();
  const { projectRoot, projectName, targetEnv, credentials } = ctx;

  const config = loadFrameworkConfig();
  const infraConfig = loadInfrastructureConfig();
  const envConfig = infraConfig?.[targetEnv] as
    | EnvironmentOverrides
    | undefined;
  const dbTier = envConfig?.database?.tier ?? DEFAULT_AZURE_DATABASE_TIER;
  const totalServiceMax = getTotalServiceMaxInstances(
    config.services,
    infraConfig,
    targetEnv,
    'azure',
  );
  const totalWorkerMax = getTotalWorkerMaxInstances(config.services);
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
  let containerAppsEnvId: string;

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
    containerAppsEnvId = getTerraformOutput(
      terraformDir,
      'container_apps_env_id',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:deploy-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Get NestJS backend services (Next.js uses App Service, see deploy-nextjs-app-services.ts)
  let services = config.services.filter((s) => s.type === 'nestjs');

  const serviceFilter = parseServiceFilter(options.service);
  if (serviceFilter) {
    services = services.filter((s) => serviceFilter.includes(s.name));
  }

  if (services.length === 0) {
    logger.warn('No Docker services found to deploy');
    return;
  }

  const imageTag = options.tag ?? getGitSha();

  // Step 1: Generate Dockerfiles (unless skipped)
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

  // Authenticate Docker with ACR once before parallel builds/pushes
  const maxParallel = options.maxParallel ?? 2;
  logger.info(`Authenticating Docker with ACR (${acrLoginServer})...`);
  await configureAcrAuth(runtime, credentials, acrLoginServer);

  // Step 2: Build Docker images (parallel with limit)
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

  // Step 3: Push Docker images (parallel with limit)
  logger.info(
    `Step 3/5: Pushing Docker images (max ${maxParallel} parallel)...`,
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

  // Step 4: Run migrations for services with databases
  const servicesWithDb = services.filter((s) => s.hasDatabase);
  if (servicesWithDb.length > 0) {
    logger.info(
      `Step 4/5: Running database migrations for ${servicesWithDb.length} service(s)...`,
    );

    for (const service of servicesWithDb) {
      logger.info(`  Running migrations for ${service.name}...`);
      try {
        await azureDbMigrateRun({
          projectRoot,
          targetEnv,
          projectName,
          credentials,
          service,
          imageTag,
        });
        logger.success(`  ${service.name} migrations complete`);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : (JSON.stringify(err, null, 2) ?? String(err));
        throw new CliError(
          `Database migration failed for ${service.name}: ${msg}`,
          'infra:deploy',
          'Check container job logs in Azure Portal > Container Apps > Jobs',
        );
      }
    }
    logger.newline();
  }

  // Step 5: Deploy to Container Apps (parallel with limit)
  logger.info(
    `Step 5/5: Deploying to Container Apps (max ${maxParallel} parallel)...`,
  );

  const deployFailures: Array<{ service: string; error?: string }> = [];

  await pMap(
    services,
    async (service) => {
      const imageUri = `${acrLoginServer}/${service.name}:${imageTag}`;
      const containerAppName = `${projectName}-${service.name}`;
      const ingressPort = 3000;

      // Get per-service config (scaling, cpu, memory)
      const serviceConfig = getServiceConfig(
        infraConfig,
        service.name,
        targetEnv,
        'azure',
      );

      // Calculate pool size for NestJS services
      const poolResult = calculatePoolSize({
        dbTier,
        provider: 'azure',
        totalServiceMaxInstances: totalServiceMax,
        totalWorkerMaxInstances: totalWorkerMax,
      });
      const poolMax = poolResult.poolMax;

      logger.newline();
      logger.info(`Deploying ${service.name} (${service.type})...`);
      logger.info(`  Image: ${imageUri}`);

      // Use shared helper for NestJS backend env vars + secrets
      const backendEnv = buildAzureBackendEnv({
        projectName,
        targetEnv,
        credentials,
        serviceName: service.name,
        hasDatabase: service.hasDatabase ?? false,
        poolMax,
      });
      const envVars = backendEnv.envVars;
      const secrets = backendEnv.secrets;
      const secretEnvVars = backendEnv.secretEnvVars;

      // Set PORT to match ingress target (Azure doesn't inject PORT like GCP Cloud Run does)
      envVars.push({ name: 'PORT', value: String(ingressPort) });

      let result: Awaited<ReturnType<typeof createOrUpdateContainerApp>>;
      try {
        result = await createOrUpdateContainerApp(runtime, {
          credentials,
          resourceGroupName,
          containerAppName,
          containerAppsEnvId,
          image: imageUri,
          envVars,
          secrets: secrets.length > 0 ? secrets : undefined,
          secretEnvVars: secretEnvVars.length > 0 ? secretEnvVars : undefined,
          ingressPort,
          externalIngress: true,
          minReplicas: serviceConfig.minInstances,
          maxReplicas: serviceConfig.maxInstances,
          cpu: parseFloat(serviceConfig.cpu),
          memory: serviceConfig.memory,
          acrLoginServer,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const hint = (err as { hint?: string })?.hint;
        const fullError = hint ? `${errorMsg}: ${hint}` : errorMsg;
        deployFailures.push({
          service: service.name,
          error: fullError,
        });
        logger.error(`  ✗ ${service.name}: ${fullError}`);
        return;
      }

      // Wait for ready
      logger.info(`  Waiting for ${service.name} to be ready...`);
      try {
        await waitForContainerAppReady(runtime, {
          credentials,
          resourceGroupName,
          containerAppName,
          timeoutMs: 300000,
        });

        logger.success(`  ${service.name} deployed`);
        if (result.fqdn) {
          logger.info(`    URL: https://${result.fqdn}`);
        }
      } catch (err) {
        const errorMsg =
          err instanceof Error
            ? err.message
            : 'Service did not reach ready state';
        deployFailures.push({
          service: service.name,
          error: errorMsg,
        });
        logger.error(`  ✗ ${service.name} failed to stabilize: ${errorMsg}`);
      }
    },
    { concurrency: maxParallel },
  );

  if (deployFailures.length > 0) {
    throw new CliError(
      `Failed to deploy ${deployFailures.length} Container App(s)`,
      'infra:deploy-services',
      deployFailures.map((f) => `${f.service}: ${f.error}`).join('\n'),
    );
  }
}
