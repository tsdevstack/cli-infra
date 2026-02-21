/**
 * GCP Database Migration Run
 *
 * Runs prisma migrate deploy in a Cloud Run Job.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import {
  buildGcpTerraformEnv,
  executeCloudRunJob,
} from '@tsdevstack/infra-core';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getMigrationJobConfig } from '../../infrastructure/merge-with-defaults';
import type { GCPCredentials, FrameworkService } from '@tsdevstack/cli/plugin';

interface GcpDbMigrateRunParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: GCPCredentials;
  service: FrameworkService;
  imageTag?: string;
}

/**
 * Run database migrations on GCP
 */
export async function gcpDbMigrateRun(
  params: GcpDbMigrateRunParams,
): Promise<void> {
  const { logger, buildSecretName, CliError } = getContext();
  const runtime = buildRuntime();
  const { projectRoot, targetEnv, projectName, credentials, service } = params;

  const tfEnv = buildGcpTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let registryUrl: string;
  let vpcNetwork: string;
  let vpcSubnet: string;
  let runtimeServiceAccount: string;

  try {
    registryUrl = getTerraformOutput(
      terraformDir,
      'artifact_registry_url',
      tfEnv,
    );
    vpcNetwork = getTerraformOutput(terraformDir, 'vpc_id', tfEnv);
    vpcSubnet = getTerraformOutput(terraformDir, 'subnet_id', tfEnv);

    const serviceAccountEmails = getTerraformOutputJson<Record<string, string>>(
      terraformDir,
      'runtime_service_account_emails',
      tfEnv,
    );
    runtimeServiceAccount = serviceAccountEmails[service.name];

    if (!runtimeServiceAccount) {
      throw new CliError(
        `Service account not found for service "${service.name}"`,
        'infra:run-db-migrate',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to create service accounts`,
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
  const tag = params.imageTag ?? 'latest';
  const imageUri = `${registryUrl}/${service.name}:${tag}`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.newline();

  // Retry only on connection errors (Prisma P1001) — on fresh deploys,
  // Cloud SQL may not be accepting connections yet even though Terraform
  // reports it as ready.  Actual migration failures are not retried.
  const maxRetries = 3;
  const retryDelay = 10;
  const migrateCmd = 'node ./node_modules/prisma/build/index.js migrate deploy';

  const retryScript =
    `attempt=1; ` +
    `while [ $attempt -le ${maxRetries} ]; do ` +
    `output=$(${migrateCmd} 2>&1) && echo "$output" && exit 0; ` +
    `echo "$output"; ` +
    `if echo "$output" | grep -q "P1001"; then ` +
    `echo "Connection failed (attempt $attempt/${maxRetries}), retrying in ${retryDelay}s..."; ` +
    `attempt=$((attempt + 1)); sleep ${retryDelay}; ` +
    `else echo "Migration error (not a connection issue), aborting."; exit 1; fi; ` +
    `done; ` +
    `echo "All ${maxRetries} connection attempts failed"; exit 1`;

  const infraConfig = loadInfrastructureConfig();
  const migrationJob = getMigrationJobConfig(infraConfig, targetEnv, 'gcp');

  const result = await executeCloudRunJob(runtime, {
    projectId: credentials.project_id,
    region: credentials.region,
    jobName: `migrate-${service.name}`,
    imageUri,
    command: ['sh', '-c', retryScript],
    vpcNetwork,
    vpcSubnet,
    secretName,
    serviceAccount: runtimeServiceAccount,
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
