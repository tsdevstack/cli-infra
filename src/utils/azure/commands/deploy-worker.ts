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
import { getAcrIdentityOutputs, getTerraformOutput } from '../terraform';
import {
  buildAzureTerraformEnv,
  deployWithActivationCheck,
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
  const { acrManagedIdentityId } = getAcrIdentityOutputs(terraformDir, tfEnv);

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

  logger.info('Deploying worker Container App...');

  const deployResult = await deployWithActivationCheck({
    runtime,
    credentials,
    resourceGroupName,
    containerAppName,
    createOptions: {
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
    },
    needsActivationCheck,
    targetMinReplicas: params.minReplicas,
    logger,
  });

  if (!deployResult.activated) {
    throw new CliError(
      `Failed to deploy worker ${worker.name}`,
      'infra:worker-deploy',
      deployResult.error ?? 'Unknown error',
    );
  }

  logger.newline();
  logger.complete(`Worker ${worker.name} deployed successfully!`);
  logger.newline();
}
