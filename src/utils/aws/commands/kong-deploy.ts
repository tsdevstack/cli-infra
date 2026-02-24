/**
 * AWS Kong Deployment
 *
 * Deploys Kong Gateway to ECS with secrets from Secrets Manager.
 * Kong requires runtime secrets: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD,
 * ALB_INTERNAL_DNS, AUTH_SERVICE_URL, KONG_TRUST_TOKEN, etc.
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
import { buildAwsTerraformEnv, waitForEcsStable } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

interface AwsKongDeployParams {
  projectRoot: string;
  targetEnv: string;
  credentials: AWSCredentials;
  imageTag: string;
}

/**
 * Kong-specific secrets that need to be injected from Secrets Manager
 */
const KONG_SECRETS = [
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_TLS',
  'ALB_INTERNAL_DNS',
  'AUTH_SERVICE_URL',
  'KONG_SSL_VERIFY',
  'KONG_TRUST_TOKEN',
  'KONG_CORS_ORIGINS',
  'TEST_PARTNER_2_API_KEY_WITH_NO_CONVENTION',
];

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
  let accountId: string;

  try {
    clusterName = getTerraformOutput(terraformDir, 'ecs_cluster_name', tfEnv);
    ecrUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
    accountId = getTerraformOutput(terraformDir, 'aws_account_id', tfEnv);
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

  // Step 2: Build secrets array for Kong
  // Secret ARN format: arn:aws:secretsmanager:REGION:ACCOUNT:secret:PROJECT-shared-SECRET_NAME
  const secretsArray = KONG_SECRETS.map((secretName) => ({
    name: secretName,
    valueFrom: `arn:aws:secretsmanager:${region}:${accountId}:secret:${projectName}-shared-${secretName}`,
  }));

  // Get existing container definition
  const existingContainer = existingTaskDef.containerDefinitions?.[0];
  if (!existingContainer) {
    throw new CliError(
      'Container definition not found',
      'infra:deploy-kong',
      'Task definition has no container definitions',
    );
  }

  // Preserve existing environment variables and add secrets
  const existingEnv = existingContainer.environment ?? [];

  // Step 3: Register new task definition with secrets
  logger.info('Registering new task definition with secrets...');
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
          image: imageUri, // Use new image
          portMappings: existingContainer.portMappings,
          environment: existingEnv,
          secrets: secretsArray, // Inject secrets from Secrets Manager
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
