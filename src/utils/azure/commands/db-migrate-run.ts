/**
 * Azure Database Migration Run
 *
 * Runs prisma migrate deploy in a Container Apps Job.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { AZURE_MIGRATION_JOB_PREFIX } from '../../../constants';
import { resolveAzureMigrationJobAccess } from '../resolve-azure-migration-job-access';
import { getAcrIdentityOutputs, getTerraformOutput } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { executeContainerJob } from './execute-container-job';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getMigrationJobConfig } from '../../infrastructure/merge-with-defaults';
import type {
  AzureCredentials,
  FrameworkService,
} from '@tsdevstack/cli/plugin';

interface AzureDbMigrateRunParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: AzureCredentials;
  service: FrameworkService;
  imageTag?: string;
}

export async function azureDbMigrateRun(
  params: AzureDbMigrateRunParams,
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
      'infra:run-db-migrate',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Managed identity for ACR pull (falls back to password if not provisioned)
  const { acrManagedIdentityId } = getAcrIdentityOutputs(terraformDir, tfEnv);

  // Migrations connect as the owner role (MIGRATION_DATABASE_URL), read
  // from Key Vault by Container Apps
  const access = await resolveAzureMigrationJobAccess({
    projectName: params.projectName,
    targetEnv,
    serviceName: service.name,
    credentials,
    terraformDir,
    tfEnv,
  });

  if (!access) {
    throw new CliError(
      'No database URL secret found (MIGRATION_DATABASE_URL or DATABASE_URL)',
      'infra:run-db-migrate',
      `Push secrets first: npx tsdevstack cloud-secrets:push --env ${targetEnv}`,
    );
  }

  const tag = params.imageTag ?? 'latest';
  const imageUri = `${acrLoginServer}/${service.name}:${tag}`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.newline();

  const infraConfig = loadInfrastructureConfig();
  const migrationJob = getMigrationJobConfig(infraConfig, targetEnv, 'azure');

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
      'deploy',
    ],
    keyVaultEnvVars: [
      { name: 'DATABASE_URL', keyVaultUrl: access.keyVaultSecretUrl },
    ],
    secretsIdentityId: access.identityId,
    acrLoginServer,
    acrManagedIdentityId,
    cpu: parseFloat(migrationJob.cpu),
    memory: migrationJob.memory,
  });

  logger.newline();
  if (result.success) {
    logger.complete('Database migrations applied successfully!');
    if (result.logs) {
      logger.info(result.logs);
    }
  } else {
    // The reason goes in the message: infra:deploy repeats only the message
    throw new CliError(
      `Database migration failed: ${result.error || 'unknown error'}`,
      'infra:run-db-migrate',
      `See the job's log: npx tsdevstack infra:logs ${AZURE_MIGRATION_JOB_PREFIX}${service.name} --env ${targetEnv}`,
    );
  }
  logger.newline();
}
