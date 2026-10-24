/**
 * Azure Database Migration Plan
 *
 * Runs prisma migrate status in a Container Apps Job.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { AZURE_MIGRATION_JOB_PREFIX } from '../../../constants';
import { getTerraformOutput } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { executeContainerJob } from './execute-container-job';
import { fetchSecret } from '../../credentials/fetch-secret';
import type {
  AzureCredentials,
  FrameworkService,
} from '@tsdevstack/cli/plugin';

interface AzureDbMigratePlanParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: AzureCredentials;
  service: FrameworkService;
}

export async function azureDbMigratePlan(
  params: AzureDbMigratePlanParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { projectRoot, targetEnv, credentials, service } = params;
  const runtime = buildRuntime();

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
      'infra:plan-db-migrate',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  const databaseUrl = fetchSecret('DATABASE_URL', targetEnv, service.name);

  if (!databaseUrl) {
    throw new CliError(
      'DATABASE_URL secret not found',
      'infra:plan-db-migrate',
      `Push secrets first: npx tsdevstack cloud-secrets:push --env ${targetEnv}`,
    );
  }

  const imageUri = `${acrLoginServer}/${service.name}:latest`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.newline();

  const result = await executeContainerJob({
    credentials,
    resourceGroupName,
    containerAppsEnvId,
    jobName: `${AZURE_MIGRATION_JOB_PREFIX}${service.name}`,
    image: imageUri,
    command: [
      'node',
      './node_modules/prisma/build/index.js',
      'migrate',
      'status',
    ],
    envVars: [{ name: 'DATABASE_URL', value: databaseUrl }],
    acrLoginServer,
  });

  logger.newline();
  if (result.success) {
    logger.complete('Migration status check completed');
    if (result.logs) {
      logger.info(result.logs);
    }
  } else {
    logger.error('Migration status check failed');
    if (result.error) {
      logger.error(result.error);
    }
  }
  logger.newline();
}
