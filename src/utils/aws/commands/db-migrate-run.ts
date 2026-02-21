/**
 * AWS Database Migration Run
 *
 * Runs prisma migrate deploy in an ECS Task.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv, executeEcsTask } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getMigrationJobConfig } from '../../infrastructure/merge-with-defaults';
import type { AWSCredentials, FrameworkService } from '@tsdevstack/cli/plugin';

interface AwsDbMigrateRunParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: AWSCredentials;
  service: FrameworkService;
  imageTag?: string;
}

/**
 * Run database migrations on AWS
 */
export async function awsDbMigrateRun(
  params: AwsDbMigrateRunParams,
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
        'infra:run-db-migrate',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to create IAM roles`,
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:run-db-migrate',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  const secretName = buildSecretName(projectName, service.name, 'DATABASE_URL');
  const secretArn = `arn:aws:secretsmanager:${credentials.region}:${credentials.accountId}:secret:${secretName}`;
  const tag = params.imageTag ?? 'latest';
  const imageUri = `${ecrUrl}/${service.name}:${tag}`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.newline();

  const infraConfig = loadInfrastructureConfig();
  const migrationJob = getMigrationJobConfig(infraConfig, targetEnv, 'aws');

  const result = await executeEcsTask(runtime, {
    region: credentials.region,
    clusterName,
    taskName: `migrate-${service.name}`,
    imageUri,
    command: [
      'node',
      './node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
    ],
    subnetIds,
    securityGroupId,
    executionRoleArn,
    taskRoleArn,
    secretArn,
    credentials,
    cpu: migrationJob.cpu,
    memory: migrationJob.memory,
  });

  logger.newline();
  if (result.success) {
    logger.complete('Migrations applied successfully!');
  } else {
    logger.error('Migration failed');
    logger.error(result.logs);
    throw new CliError(
      'Database migration failed',
      'infra:run-db-migrate',
      result.logs,
    );
  }
  logger.newline();
}
