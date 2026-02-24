/**
 * AWS Database Migration Plan
 *
 * Runs prisma migrate status in an ECS Task.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv, executeEcsTask } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCredentials, FrameworkService } from '@tsdevstack/cli/plugin';

interface AwsDbMigratePlanParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: AWSCredentials;
  service: FrameworkService;
}

/**
 * Run database migration status check on AWS
 */
export async function awsDbMigratePlan(
  params: AwsDbMigratePlanParams,
): Promise<void> {
  const { logger, buildSecretName, CliError } = getContext();
  const { projectRoot, targetEnv, projectName, credentials, service } = params;

  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let ecrUrl: string;
  let clusterName: string;
  let subnetIds: string[];
  let securityGroupId: string;
  let executionRoleArn: string;
  let taskRoleArn: string;

  try {
    ecrUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
    clusterName = getTerraformOutput(terraformDir, 'ecs_cluster_name', tfEnv);
    subnetIds = JSON.parse(
      getTerraformOutput(terraformDir, 'private_subnet_ids', tfEnv),
    );
    securityGroupId = getTerraformOutput(
      terraformDir,
      'ecs_security_group_id',
      tfEnv,
    );
    executionRoleArn = getTerraformOutput(
      terraformDir,
      'ecs_execution_role_arn',
      tfEnv,
    );

    const taskRoleArns = JSON.parse(
      getTerraformOutput(terraformDir, 'ecs_task_role_arns', tfEnv),
    ) as Record<string, string>;
    taskRoleArn = taskRoleArns[service.name];

    if (!taskRoleArn) {
      throw new CliError(
        `Task role not found for service "${service.name}"`,
        'infra:plan-db-migrate',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to create IAM roles`,
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:plan-db-migrate',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  const secretName = buildSecretName(projectName, service.name, 'DATABASE_URL');
  const secretArn = `arn:aws:secretsmanager:${credentials.region}:${credentials.accountId}:secret:${secretName}`;
  const imageUri = `${ecrUrl}/${service.name}:latest`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.newline();

  const result = await executeEcsTask(runtime, {
    region: credentials.region,
    clusterName,
    taskName: `migrate-${service.name}`,
    imageUri,
    command: [
      'node',
      './node_modules/prisma/build/index.js',
      'migrate',
      'status',
    ],
    subnetIds,
    securityGroupId,
    executionRoleArn,
    taskRoleArn,
    secretArn,
    credentials,
  });

  logger.newline();
  if (result.success) {
    logger.complete('Migration status check completed');
  } else {
    logger.error('Migration status check failed');
    logger.error(result.logs);
  }
  logger.newline();
}
