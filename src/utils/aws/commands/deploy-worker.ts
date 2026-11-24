/**
 * AWS Worker Deployment
 *
 * Deploys a worker service to ECS.
 * Workers share the same Docker image as their base service but run
 * a different entrypoint and have CPU always allocated. A worker of a
 * service with a database gets the service's DATABASE_URL, as on GCP and
 * Azure: Prisma needs it in the environment at start.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { getTerraformOutput } from '../terraform';
import {
  buildAwsTerraformEnv,
  deployEcsServiceWithSecrets,
  waitForEcsStable,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { buildAwsDatabaseUrlSecretArn } from '../build-aws-database-url-secret-arn';
import type { AWSCredentials, FrameworkService } from '@tsdevstack/cli/plugin';

interface AwsDeployWorkerParams {
  projectRoot: string;
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
  worker: FrameworkService;
  baseService: FrameworkService;
  imageTag: string;
}

/**
 * Deploy a worker service to ECS
 */
export async function awsDeployWorker(
  params: AwsDeployWorkerParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const {
    projectRoot,
    projectName,
    targetEnv,
    credentials,
    worker,
    baseService,
    imageTag,
  } = params;

  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let clusterName: string;
  let ecrUrl: string;

  try {
    clusterName = getTerraformOutput(terraformDir, 'ecs_cluster_name', tfEnv);
    ecrUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
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
  const imageUri = `${ecrUrl}/${baseService.name}:${imageTag}`;

  // Log deployment info
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Worker: ${worker.name}`);
  logger.info(`Base service: ${baseService.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.info(`Cluster: ${clusterName}`);
  logger.newline();

  // Register a task definition with this image and move the service to it,
  // as the backends do. Terraform's definition names the base service's
  // `:latest` image: forcing a new deployment of that would keep the worker
  // on whatever was pushed last instead of this tag. The base service's
  // DATABASE_URL is injected here (hasDatabase would name the worker's own
  // secret, which doesn't exist); the other secrets are read at runtime.
  try {
    logger.info('Registering task definition and updating ECS service...');
    const result = await deployEcsServiceWithSecrets(runtime, {
      credentials,
      projectName,
      clusterName,
      serviceName: worker.name,
      imageUri,
      hasDatabase: false,
      additionalSecrets: baseService.hasDatabase
        ? {
            DATABASE_URL: buildAwsDatabaseUrlSecretArn(
              credentials,
              projectName,
              baseService.name,
            ),
          }
        : undefined,
    });

    logger.info(`Task definition: ${result.taskDefinitionArn}`);
    if (result.deploymentId) {
      logger.info(`Deployment started: ${result.deploymentId}`);
    }
    logger.newline();

    // Wait for service to stabilize
    logger.info('Waiting for service to stabilize...');
    await waitForEcsStable(runtime, {
      credentials,
      clusterName,
      serviceName: worker.name,
      timeoutMs: 300000, // 5 minutes
    });
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(
      `Failed to deploy worker ${worker.name}`,
      'infra:worker-deploy',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }

  logger.newline();
  logger.complete(`Worker ${worker.name} deployed successfully!`);
  logger.newline();
}
