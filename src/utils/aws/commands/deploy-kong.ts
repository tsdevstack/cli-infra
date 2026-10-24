/**
 * AWS Kong Deployment
 *
 * Deploys Kong Gateway to ECS. All config values are baked into kong.yml
 * at Docker image build time — no runtime secrets needed.
 */

import path from 'node:path';
import {
  ECSClient,
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import { getContext } from '../../../context';
import { getTerraformOutput } from '../../terraform';
import {
  AWS_KONG_CLIENT_IP_SETTINGS,
  buildAwsTerraformEnv,
  waitForEcsStable,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

interface AwsKongDeployParams {
  projectRoot: string;
  targetEnv: string;
  credentials: AWSCredentials;
  imageTag: string;
}

/**
 * Deploy Kong Gateway to ECS
 */
export async function awsKongDeploy(
  params: AwsKongDeployParams,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();
  const { projectRoot, targetEnv, credentials, imageTag } = params;

  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  // Get required terraform outputs
  let clusterName: string;
  let ecrUrl: string;

  try {
    clusterName = getTerraformOutput(terraformDir, 'ecs_cluster_name', tfEnv);
    ecrUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:deploy-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Extract project name from ECR URL (format: ACCOUNT.dkr.ecr.REGION.amazonaws.com/PROJECT)
  const projectName = ecrUrl.split('/')[1];
  const region = credentials.region;

  const imageUri = `${ecrUrl}/kong:${imageTag}`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Image: ${imageUri}`);
  logger.info(`Cluster: ${clusterName}`);
  logger.newline();

  // Build ECS client config
  const ecsConfig = isCIEnv()
    ? { region }
    : {
        region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
        },
      };

  const ecs = new ECSClient(ecsConfig);

  // Step 1: Fetch existing task definition
  logger.info('Fetching current task definition...');
  const describeResponse = await ecs.send(
    new DescribeTaskDefinitionCommand({
      taskDefinition: `${projectName}-kong`,
    }),
  );

  const existingTaskDef = describeResponse.taskDefinition;
  if (!existingTaskDef) {
    throw new CliError(
      'Task definition not found',
      'infra:deploy-kong',
      `Task definition ${projectName}-kong does not exist`,
    );
  }

  // Get existing container definition
  const existingContainer = existingTaskDef.containerDefinitions?.[0];
  if (!existingContainer) {
    throw new CliError(
      'Container definition not found',
      'infra:deploy-kong',
      'Task definition has no container definitions',
    );
  }

  // Keep the task definition's environment, with the client address settings
  // on top: Terraform sets them at creation, but the service keeps the CLI's
  // task definitions afterwards, so this is how they reach an existing
  // environment (and how a changed setting takes effect on redeploy)
  const clientIpSettings: Record<string, string> = AWS_KONG_CLIENT_IP_SETTINGS;
  const existingEnv = [
    ...(existingContainer.environment ?? []).filter(
      (entry) => entry.name === undefined || !(entry.name in clientIpSettings),
    ),
    ...Object.entries(clientIpSettings).map(([name, value]) => ({
      name,
      value,
    })),
  ];

  // Step 2: Register new task definition with updated image
  logger.info('Registering new task definition...');
  const registerResponse = await ecs.send(
    new RegisterTaskDefinitionCommand({
      family: existingTaskDef.family!,
      networkMode: existingTaskDef.networkMode,
      requiresCompatibilities: existingTaskDef.requiresCompatibilities,
      cpu: existingTaskDef.cpu,
      memory: existingTaskDef.memory,
      executionRoleArn: existingTaskDef.executionRoleArn,
      taskRoleArn: existingTaskDef.taskRoleArn,
      containerDefinitions: [
        {
          name: existingContainer.name,
          image: imageUri,
          portMappings: existingContainer.portMappings,
          environment: existingEnv,
          logConfiguration: existingContainer.logConfiguration,
          healthCheck: existingContainer.healthCheck,
          essential: existingContainer.essential,
        },
      ],
    }),
  );

  const newTaskDefArn = registerResponse.taskDefinition?.taskDefinitionArn;
  if (!newTaskDefArn) {
    throw new CliError(
      'Failed to register task definition',
      'infra:deploy-kong',
      'Task definition ARN not returned',
    );
  }

  logger.info(`New task definition: ${newTaskDefArn}`);

  // Step 4: Update ECS service with new task definition
  logger.info('Updating ECS service...');
  const updateResponse = await ecs.send(
    new UpdateServiceCommand({
      cluster: clusterName,
      service: 'kong',
      taskDefinition: newTaskDefArn,
      forceNewDeployment: true,
    }),
  );

  const deploymentId =
    updateResponse.service?.deployments?.[0]?.id ?? 'unknown';
  logger.info(`Deployment started: ${deploymentId}`);
  logger.newline();

  // Wait for service to stabilize
  logger.info('Waiting for service to stabilize...');
  try {
    await waitForEcsStable(runtime, {
      credentials,
      clusterName,
      serviceName: 'kong',
      timeoutMs: 300000, // 5 minutes
    });
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(
      'Kong service failed to stabilize',
      'infra:deploy-kong',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }

  logger.newline();
  logger.complete('Kong Gateway deployed successfully!');
  logger.newline();
}
