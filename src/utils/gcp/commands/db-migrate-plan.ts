/**
 * GCP Database Migration Plan
 *
 * Runs prisma migrate status in a Cloud Run Job.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import {
  buildGcpTerraformEnv,
  executeCloudRunJob,
} from '@tsdevstack/infra-core';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import type { GCPCredentials, FrameworkService } from '@tsdevstack/cli/plugin';

interface GcpDbMigratePlanParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: GCPCredentials;
  service: FrameworkService;
}

/**
 * Run database migration status check on GCP
 */
export async function gcpDbMigratePlan(
  params: GcpDbMigratePlanParams,
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
        'infra:plan-db-migrate',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to create service accounts`,
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
  const imageUri = `${registryUrl}/${service.name}:latest`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name}`);
  logger.info(`Image: ${imageUri}`);
  logger.newline();

  const result = await executeCloudRunJob(runtime, {
    projectId: credentials.project_id,
    region: credentials.region,
    jobName: `migrate-${service.name}`,
    imageUri,
    command: [
      'node',
      './node_modules/prisma/build/index.js',
      'migrate',
      'status',
    ],
    vpcNetwork,
    vpcSubnet,
    secretName,
    serviceAccount: runtimeServiceAccount,
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
