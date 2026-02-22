/**
 * GCP Deploy Service
 *
 * Deploys a single service to Cloud Run.
 * - NestJS: Internal ingress, VPC access, database connection
 * - Next.js: Internal + LB ingress, VPC access (accessible only via load balancer)
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../../../context';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/merge-with-defaults';
import { getGitSha } from '../../docker';
import {
  buildBackendEnvVars,
  buildBackendSecrets,
  buildFrontendEnvVars,
  buildFrontendSecrets,
  buildGcpTerraformEnv,
  calculatePoolSize,
  deployCloudRunService,
  getTotalWorkerMaxInstances,
  waitForImage,
} from '@tsdevstack/infra-core';
import { getServiceSecretKeys } from '../../deploy/get-service-secret-keys';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import type { SecretConfig } from '@tsdevstack/infra-core';
import type { EnvironmentOverrides } from '../../infrastructure/types';
import type { GCPCredentials, FrameworkService } from 'tsdevstack/plugin';

export interface GcpDeployServiceOptions {
  projectRoot: string;
  projectName: string;
  targetEnv: string;
  credentials: GCPCredentials;
  service: FrameworkService;
  tag?: string;
}

/**
 * Deploy a single service to GCP Cloud Run
 */
export async function gcpDeployService(
  options: GcpDeployServiceOptions,
): Promise<void> {
  const {
    logger,
    CliError,
    buildSecretName,
    DEFAULT_DATABASE_TIER,
    loadFrameworkConfig,
  } = getContext();
  const runtime = buildRuntime();

  const { projectRoot, projectName, targetEnv, credentials, service } = options;

  // Only NestJS and Next.js services are supported
  if (service.type !== 'nestjs' && service.type !== 'nextjs') {
    throw new CliError(
      `Service type "${service.type}" cannot be deployed to Cloud Run`,
      'infra:service-deploy',
      'Only NestJS and Next.js services are supported',
    );
  }

  const isNestJs = service.type === 'nestjs';

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
      'infra:service-deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Build Terraform environment
  const tfEnv = buildGcpTerraformEnv(runtime, credentials);

  // Get terraform outputs
  let artifactRegistryUrl: string;
  let runtimeServiceAccount: string;
  let vpcNetwork: string | undefined;
  let vpcSubnet: string | undefined;

  try {
    artifactRegistryUrl = getTerraformOutput(
      terraformDir,
      'artifact_registry_url',
      tfEnv,
    );

    // Get per-service SA from the map output
    const serviceAccountEmails = getTerraformOutputJson<Record<string, string>>(
      terraformDir,
      'runtime_service_account_emails',
      tfEnv,
    );
    runtimeServiceAccount = serviceAccountEmails[service.name];

    if (!runtimeServiceAccount) {
      throw new CliError(
        `Service account not found for service "${service.name}"`,
        'infra:service-deploy',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to create service accounts`,
      );
    }

    // Fetch VPC network and subnet for Direct VPC Egress
    vpcNetwork = getTerraformOutput(terraformDir, 'vpc_id', tfEnv);
    vpcSubnet = getTerraformOutput(terraformDir, 'subnet_id', tfEnv);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:service-deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Load infrastructure config
  const infraConfig = loadInfrastructureConfig();
  const serviceConfig = getServiceConfig(
    infraConfig,
    service.name,
    targetEnv,
    'gcp',
  );
  const { maxInstances } = serviceConfig;

  // Calculate pool size for NestJS services
  let poolMax = 0;
  let dbTier = '';
  let dbConnections = 0;

  if (isNestJs) {
    const config = loadFrameworkConfig();
    const envConfig = infraConfig?.[targetEnv] as
      | EnvironmentOverrides
      | undefined;
    dbTier = envConfig?.database?.tier ?? DEFAULT_DATABASE_TIER;
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
    poolMax = poolResult.poolMax;
    dbConnections = poolResult.dbConnections;
  }

  // Build image URI
  const imageTag = options.tag ?? getGitSha();
  const imageUri = `${artifactRegistryUrl}/${service.name}:${imageTag}`;

  // Log deployment info
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name} (${service.type})`);
  logger.info(`Image: ${imageUri}`);
  logger.info(`Max instances: ${maxInstances}`);
  if (isNestJs) {
    logger.info(`Database tier: ${dbTier} (${dbConnections} max connections)`);
    logger.info(`Pool max per instance: ${poolMax}`);
  }
  logger.newline();

  // Verify image exists before deploying
  await waitForImage(runtime, {
    imageUri,
    credentials,
  });
  logger.newline();

  // Build environment variables and secrets based on service type
  const envVars = isNestJs
    ? buildBackendEnvVars({
        provider: 'gcp',
        projectName,
        projectId: credentials.project_id,
        poolMax,
      })
    : buildFrontendEnvVars();

  let secrets: SecretConfig[];
  if (isNestJs) {
    secrets = buildBackendSecrets(
      projectName,
      service.name,
      service.hasDatabase ?? false,
      buildSecretName,
    );
  } else {
    const config = loadFrameworkConfig();
    const frontendKeys = getServiceSecretKeys(service.name, config);
    secrets = buildFrontendSecrets(projectName, buildSecretName, frontendKeys);
  }

  // Deploy to Cloud Run
  const result = await deployCloudRunService(runtime, {
    projectId: credentials.project_id,
    region: credentials.region,
    serviceName: service.name,
    imageUri,
    vpcNetwork,
    vpcSubnet,
    serviceAccount: runtimeServiceAccount,
    credentials,
    minInstances: serviceConfig.minInstances,
    maxInstances,
    cpu: serviceConfig.cpu,
    memory: serviceConfig.memory,
    timeout: serviceConfig.timeout,
    concurrency: serviceConfig.concurrency,
    envVars,
    secrets,
    ingress: isNestJs
      ? 'INGRESS_TRAFFIC_INTERNAL_ONLY'
      : 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
  });

  logger.newline();
  if (result.success) {
    logger.complete(`Service ${service.name} deployed successfully!`);
    if (result.serviceUrl) {
      logger.info(`Service URL: ${result.serviceUrl}`);
    }
  }
  logger.newline();
}
