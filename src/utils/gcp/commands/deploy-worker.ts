/**
 * GCP Worker Deployment
 *
 * Deploys a worker service to Cloud Run.
 * Workers share the same Docker image as their base service but run
 * a different entrypoint (node dist/worker.js) and have CPU always allocated.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import {
  buildBackendEnvVars,
  buildBackendSecrets,
  buildGcpTerraformEnv,
  calculatePoolSize,
  deployCloudRunService,
  getTotalWorkerMaxInstances,
  waitForImage,
} from '@tsdevstack/infra-core';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import type { EnvironmentOverrides } from '../../infrastructure/types';
import type { GCPCredentials, FrameworkService } from 'tsdevstack/plugin';

interface GcpDeployWorkerParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: GCPCredentials;
  worker: FrameworkService;
  baseService: FrameworkService;
  imageTag: string;
  minInstances?: number;
  maxInstances?: number;
  cpu?: string;
  memory?: string;
  timeout?: string;
  concurrency?: number;
}

/**
 * Deploy a worker service to Cloud Run
 */
export async function gcpDeployWorker(
  params: GcpDeployWorkerParams,
): Promise<void> {
  const {
    logger,
    buildSecretName,
    CliError,
    DEFAULT_DATABASE_TIER,
    loadFrameworkConfig,
  } = getContext();
  const runtime = buildRuntime();
  const {
    projectRoot,
    targetEnv,
    projectName,
    credentials,
    worker,
    baseService,
    imageTag,
  } = params;

  const tfEnv = buildGcpTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let registryUrl: string;
  let runtimeServiceAccount: string;
  let vpcNetwork: string | undefined;
  let vpcSubnet: string | undefined;

  try {
    registryUrl = getTerraformOutput(
      terraformDir,
      'artifact_registry_url',
      tfEnv,
    );

    // Worker uses the same service account as its base service
    const serviceAccountEmails = getTerraformOutputJson<Record<string, string>>(
      terraformDir,
      'runtime_service_account_emails',
      tfEnv,
    );
    runtimeServiceAccount = serviceAccountEmails[baseService.name];

    if (!runtimeServiceAccount) {
      throw new CliError(
        `Service account not found for base service "${baseService.name}"`,
        'infra:worker-deploy',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to create service accounts`,
      );
    }

    // Workers need VPC access for Redis/DB
    vpcNetwork = getTerraformOutput(terraformDir, 'vpc_id', tfEnv);
    vpcSubnet = getTerraformOutput(terraformDir, 'subnet_id', tfEnv);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:worker-deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Build image URI using base service image
  const imageUri = `${registryUrl}/${baseService.name}:${imageTag}`;

  // Log deployment info
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Worker: ${worker.name}`);
  logger.info(`Base service: ${baseService.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.info(`Command: node dist/worker.js`);
  logger.info(`CPU idle: false (always allocated)`);
  logger.newline();

  // Verify image exists before deploying
  await waitForImage(runtime, {
    imageUri,
    credentials,
  });
  logger.newline();

  // Calculate worker pool size dynamically
  const config = loadFrameworkConfig();
  const infraConfig = loadInfrastructureConfig();
  const envConfig = infraConfig?.[targetEnv] as
    | EnvironmentOverrides
    | undefined;
  const dbTier = envConfig?.database?.tier ?? DEFAULT_DATABASE_TIER;
  const totalServiceMax = getTotalServiceMaxInstances(
    config.services,
    infraConfig,
    targetEnv,
    'gcp',
  );
  const totalWorkerMax = getTotalWorkerMaxInstances(config.services);
  const poolResult = calculatePoolSize({
    dbTier,
    provider: 'gcp',
    totalServiceMaxInstances: totalServiceMax,
    totalWorkerMaxInstances: totalWorkerMax,
  });

  // Workers use backend env vars and secrets (they need DB/Redis access)
  const envVars = buildBackendEnvVars({
    provider: 'gcp',
    projectName,
    projectId: credentials.project_id,
    poolMax: poolResult.poolMax,
  });

  const secrets = buildBackendSecrets(
    projectName,
    baseService.name, // Use base service for DATABASE_URL secret scope
    baseService.hasDatabase ?? false,
    buildSecretName,
  );

  // Deploy worker to Cloud Run
  const result = await deployCloudRunService(runtime, {
    projectId: credentials.project_id,
    region: credentials.region,
    serviceName: worker.name,
    imageUri,
    vpcNetwork,
    vpcSubnet,
    serviceAccount: runtimeServiceAccount,
    credentials,
    minInstances: params.minInstances ?? 1,
    maxInstances: params.maxInstances ?? 3,
    cpu: params.cpu ?? '1',
    memory: params.memory ?? '512Mi',
    timeout: params.timeout ?? '300',
    concurrency: params.concurrency ?? 1,
    envVars,
    secrets,
    ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
    command: ['node', 'dist/worker.js'],
    cpuIdle: false,
  });

  logger.newline();
  if (result.success) {
    logger.complete(`Worker ${worker.name} deployed successfully!`);
  }
  logger.newline();
}
