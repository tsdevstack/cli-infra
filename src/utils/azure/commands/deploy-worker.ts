/**
 * Azure Worker Deployment
 *
 * Deploys a worker service to Azure Container Apps.
 * Workers share the same Docker image as their base service but run
 * a different entrypoint and have CPU always allocated.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import {
  buildAzureTerraformEnv,
  createOrUpdateContainerApp,
  waitForContainerAppActivation,
  waitForContainerAppReady,
} from '@tsdevstack/infra-core';
import type {
  AzureCredentials,
  FrameworkService,
} from '@tsdevstack/cli/plugin';

interface AzureDeployWorkerParams {
  projectRoot: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  worker: FrameworkService;
  baseService: FrameworkService;
  imageTag: string;
  envVars: Array<{ name: string; value: string }>;
  secrets: Array<{ name: string; value: string }>;
  secretEnvVars: Array<{ name: string; secretRef: string }>;
  minReplicas: number;
  maxReplicas: number;
  cpu: number;
  memory: string;
}

export async function azureDeployWorker(
  params: AzureDeployWorkerParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const runtime = buildRuntime();
  const {
    projectRoot,
    projectName,
    targetEnv,
    credentials,
    worker,
    baseService,
    imageTag,
  } = params;

  const tfEnv = buildAzureTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

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
      'infra:worker-deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Managed identity for ACR pull (falls back to password if not provisioned)
  let acrManagedIdentityId: string | undefined;
  try {
    acrManagedIdentityId = getTerraformOutput(
      terraformDir,
      'container_apps_acr_identity_id',
      tfEnv,
    );
  } catch {
    // Old Terraform state — fall back to password-based auth
  }

  // Workers use the base service image
  const imageUri = `${acrLoginServer}/${baseService.name}:${imageTag}`;
  const containerAppName = `${projectName}-${worker.name}`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Worker: ${worker.name}`);
  logger.info(`Base service: ${baseService.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.newline();

  // Deploy worker Container App
  // When using managed identity with minReplicas=0, verify activation
  // with retry to handle Azure RBAC propagation delay.
  const needsActivationCheck =
    !!acrManagedIdentityId && params.minReplicas === 0;
  const deployMinReplicas = needsActivationCheck ? 1 : params.minReplicas;

  const MAX_ACTIVATION_RETRIES = 6;
  const ACTIVATION_RETRY_DELAY_MS = 15_000;

  const createOptions = {
    credentials,
    resourceGroupName,
    containerAppName,
    containerAppsEnvId,
    image: imageUri,
    command: ['node', 'dist/worker.js'],
    envVars: params.envVars,
    secrets: params.secrets,
    secretEnvVars: params.secretEnvVars,
    // No ingress — workers don't accept HTTP
    minReplicas: deployMinReplicas,
    maxReplicas: params.maxReplicas,
    cpu: params.cpu,
    memory: params.memory,
    acrLoginServer,
    acrManagedIdentityId,
  };

  logger.info('Deploying worker Container App...');

  let activated = false;

  for (
    let attempt = 1;
    attempt <= (needsActivationCheck ? MAX_ACTIVATION_RETRIES : 1);
    attempt++
  ) {
    try {
      await createOrUpdateContainerApp(runtime, createOptions);

      logger.info('Waiting for worker to be ready...');
      await waitForContainerAppReady(runtime, {
        credentials,
        resourceGroupName,
        containerAppName,
        timeoutMs: 300000,
      });
    } catch (err) {
      if (err instanceof CliError) throw err;
      throw new CliError(
        `Failed to deploy worker ${worker.name}`,
        'infra:worker-deploy',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }

    if (!needsActivationCheck) {
      activated = true;
      break;
    }

    const activation = await waitForContainerAppActivation(runtime, {
      credentials,
      resourceGroupName,
      containerAppName,
    });

    if (activation.healthy) {
      activated = true;
      break;
    }

    if (attempt < MAX_ACTIVATION_RETRIES) {
      logger.warn(
        `  ACR identity RBAC propagating, retry ${attempt}/${MAX_ACTIVATION_RETRIES} in ${ACTIVATION_RETRY_DELAY_MS / 1000}s... (${activation.error})`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, ACTIVATION_RETRY_DELAY_MS),
      );
    } else {
      throw new CliError(
        `Worker ${worker.name} activation failed after ${MAX_ACTIVATION_RETRIES} retries`,
        'infra:worker-deploy',
        activation.error ?? 'Unknown activation error',
      );
    }
  }

  // Scale back to minReplicas=0 now that image pull is verified
  if (activated && needsActivationCheck) {
    logger.info(`Scaling worker to minReplicas=${params.minReplicas}...`);
    try {
      await createOrUpdateContainerApp(runtime, {
        ...createOptions,
        minReplicas: params.minReplicas,
      });
    } catch {
      logger.warn(
        `Could not scale worker to minReplicas=${params.minReplicas}`,
      );
    }
  }

  logger.newline();
  logger.complete(`Worker ${worker.name} deployed successfully!`);
  logger.newline();
}
