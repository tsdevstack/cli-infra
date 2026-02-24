/**
 * AWS Remove Detached Worker
 *
 * Removes an orphaned worker from ECS.
 */

import { getContext } from '../../../context';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv, deleteEcsService } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

interface AwsRemoveDetachedWorkerParams {
  workerName: string;
  projectRoot: string;
  targetEnv: string;
  credentials: AWSCredentials;
}

/**
 * Remove a detached worker from ECS
 */
export async function awsRemoveDetachedWorker(
  params: AwsRemoveDetachedWorkerParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { workerName, projectRoot, targetEnv, credentials } = params;

  // Get cluster name from terraform
  const terraformDir = `${projectRoot}/infrastructure/terraform/${targetEnv}`;
  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);

  let clusterName: string;
  try {
    clusterName = getTerraformOutput(terraformDir, 'ecs_cluster_name', tfEnv);
  } catch {
    throw new CliError(
      'Failed to get ECS cluster name from Terraform outputs',
      'infra:remove-detached-worker',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  // Delete ECS service
  logger.info('Deleting ECS service...');

  const result = await deleteEcsService(runtime, {
    credentials,
    clusterName,
    serviceName: workerName,
  });

  if (!result.success) {
    throw new CliError(
      `Failed to delete worker: ${result.error}`,
      'infra:remove-detached-worker',
      'Check if the worker exists and you have permissions',
    );
  }

  if (result.deleted) {
    logger.success(`Deleted worker: ${workerName}`);
  } else {
    logger.info(`Worker not found (already deleted): ${workerName}`);
  }
}
