/**
 * infra:worker-deploy Command
 *
 * Deploys a worker service to Cloud Run (GCP) or ECS (AWS).
 * Workers share the same Docker image as their base service but run
 * a different entrypoint (node dist/worker.js) and have CPU always allocated.
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { getGitSha } from '../utils/docker';
import { gcpDeployWorker } from '../utils/gcp/commands';
import { awsDeployWorker } from '../utils/aws/commands';
import {
  azureDeployWorker,
  buildAzureBackendEnv,
} from '../utils/azure/commands';
import {
  buildAzureTerraformEnv,
  calculatePoolSize,
  getTotalWorkerMaxInstances,
} from '@tsdevstack/infra-core';
import { getTotalServiceMaxInstances } from '../utils/deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../utils/infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../utils/infrastructure/get-service-config';
import { getAcrIdentityOutputs } from '../utils/azure/terraform';
import { buildRuntime } from '../utils/build-runtime';
import type { EnvironmentOverrides } from '../utils/infrastructure/types';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from '@tsdevstack/cli/plugin';

interface InfraWorkerDeployOptions {
  env?: string;
  /** Worker service name (e.g., "auth-worker") */
  worker: string;
  /** Base service name (e.g., "auth-service") */
  baseService: string;
  tag?: string;
}

/**
 * Deploy a worker service to Cloud Run (GCP) or ECS (AWS)
 *
 * Workers use the same image as their base service but:
 * - Run `node dist/worker.js` instead of main app
 * - Have CPU always allocated (cpuIdle: false) for queue processing
 * - Have min 1 instance to ensure queue jobs are processed
 */
export async function infraWorkerDeploy(
  options: InfraWorkerDeployOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();

  logger.newline();
  logger.info(`Deploying worker: ${options.worker}...`);
  logger.newline();

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:worker-deploy');
  const { projectRoot, targetEnv, provider, projectName } = ctx;

  const config = loadFrameworkConfig();

  // Find the worker service config
  const worker = config.services.find((s) => s.name === options.worker);
  if (!worker) {
    throw new CliError(
      `Worker "${options.worker}" not found in config`,
      'infra:worker-deploy',
      'Ensure the worker is defined in .tsdevstack/config.json',
    );
  }

  // Find the base service config (for hasDatabase check)
  const baseService = config.services.find(
    (s) => s.name === options.baseService,
  );
  if (!baseService) {
    throw new CliError(
      `Base service "${options.baseService}" not found`,
      'infra:worker-deploy',
      'Ensure the base service exists in config',
    );
  }

  // Validate terraform directory
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'infra:worker-deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  const imageTag = options.tag ?? getGitSha();

  if (provider === 'gcp') {
    await gcpDeployWorker({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as GCPCredentials,
      worker,
      baseService,
      imageTag,
    });
  } else if (provider === 'aws') {
    await awsDeployWorker({
      projectRoot,
      projectName,
      targetEnv,
      credentials: ctx.credentials as AWSCredentials,
      worker,
      baseService,
      imageTag,
    });
  } else if (provider === 'azure') {
    const { DEFAULT_AZURE_DATABASE_TIER } = getContext();
    const azureCredentials = ctx.credentials as AzureCredentials;
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
    const totalWorkerMax = getTotalWorkerMaxInstances(config.services, {
      infraConfig,
      targetEnv,
    });

    const { poolMax: workerPoolMax } = calculatePoolSize({
      dbTier,
      provider: 'azure',
      totalServiceMaxInstances: totalServiceMax,
      totalWorkerMaxInstances: totalWorkerMax,
    });

    // Read managed identity client ID from Terraform for Key Vault access
    const runtime = buildRuntime();
    const tfEnv = buildAzureTerraformEnv(runtime, azureCredentials);
    const { managedIdentityClientId } = getAcrIdentityOutputs(
      terraformDir,
      tfEnv,
    );

    const backendEnv = buildAzureBackendEnv({
      projectName,
      targetEnv,
      credentials: azureCredentials,
      serviceName: baseService.name,
      hasDatabase: baseService.hasDatabase ?? false,
      hasStorage: (config.storage?.buckets?.length ?? 0) > 0,
      poolMax: workerPoolMax,
      managedIdentityClientId,
    });

    const workerConfig = getServiceConfig(
      infraConfig,
      worker.name,
      targetEnv,
      'azure',
    );

    await azureDeployWorker({
      projectRoot,
      projectName,
      targetEnv,
      credentials: azureCredentials,
      worker,
      baseService,
      imageTag,
      envVars: backendEnv.envVars,
      secrets: backendEnv.secrets,
      secretEnvVars: backendEnv.secretEnvVars,
      // Workers default to min 1 (always running for queue processing)
      minReplicas: Math.max(1, workerConfig.minInstances),
      maxReplicas: workerConfig.maxInstances,
      cpu: parseFloat(workerConfig.cpu),
      memory: workerConfig.memory,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:worker-deploy',
      'Supported providers: gcp, aws, azure',
    );
  }
}
