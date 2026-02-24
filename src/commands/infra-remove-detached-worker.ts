/**
 * infra:remove-detached-worker Command
 *
 * Removes an orphaned worker from Cloud Run (GCP) or ECS (AWS).
 * Use this for workers that exist in cloud but not in config.json.
 *
 * Workers that are coupled to their base service are removed automatically
 * when the base service is removed via infra:remove-service.
 *
 * This command only deletes the Cloud Run/ECS service - workers share:
 * - Docker image (from base service)
 * - Service account/IAM role (from base service)
 * - Secrets (from base service)
 */

import inquirer from 'inquirer';
import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import {
  gcpRemoveDetachedWorker,
  selectWorkerInteractiveGcp,
} from '../utils/gcp/commands';
import { awsRemoveDetachedWorker } from '../utils/aws/commands';
import {
  azureRemoveDetachedWorker,
  selectWorkerInteractiveAzure,
} from '../utils/azure/commands';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from '@tsdevstack/cli/plugin';

interface InfraRemoveDetachedWorkerOptions {
  env?: string;
  worker?: string;
  confirm?: boolean;
}

/**
 * Remove an orphaned worker from Cloud Run (GCP) or ECS (AWS)
 */
export async function infraRemoveDetachedWorker(
  options: InfraRemoveDetachedWorkerOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();

  logger.newline();
  logger.warn('Remove Detached Worker from Cloud');
  logger.newline();

  const runningInCI = isCIEnv();

  // CI mode: require all params before loading credentials
  if (runningInCI) {
    if (!options.confirm) {
      throw new CliError(
        '--confirm flag required in CI mode',
        'infra:remove-detached-worker',
        'Add --confirm to skip interactive prompts',
      );
    }
    if (!options.worker) {
      throw new CliError(
        '--worker flag required in CI mode',
        'infra:remove-detached-worker',
        'Specify worker name: --worker auth-worker',
      );
    }
  }

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:remove-detached-worker');
  const { projectRoot, projectName, targetEnv, provider } = ctx;

  // Resolve worker name
  let workerName: string;
  if (options.worker) {
    workerName = options.worker;
  } else if (provider === 'gcp') {
    workerName = await selectWorkerInteractiveGcp(
      ctx.credentials as GCPCredentials,
      projectName,
    );
  } else if (provider === 'azure') {
    workerName = await selectWorkerInteractiveAzure(
      ctx.credentials as AzureCredentials,
      projectName,
      targetEnv,
    );
  } else {
    throw new CliError(
      '--worker flag required for AWS',
      'infra:remove-detached-worker',
      'Interactive discovery not supported for AWS. Specify worker name: --worker auth-worker',
    );
  }

  logger.info(`Worker: ${workerName}`);
  logger.info(`Environment: ${targetEnv}`);
  logger.newline();

  // Confirmation (interactive only)
  if (!runningInCI) {
    const serviceType =
      provider === 'gcp'
        ? 'Cloud Run'
        : provider === 'azure'
          ? 'Container Apps'
          : 'ECS';
    logger.warn(`This will PERMANENTLY DELETE the worker from ${serviceType}.`);
    logger.newline();

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Delete worker "${workerName}" from ${targetEnv}?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      logger.info('Aborted.');
      return;
    }
  }

  if (provider === 'gcp') {
    await gcpRemoveDetachedWorker({
      workerName,
      credentials: ctx.credentials as GCPCredentials,
    });
  } else if (provider === 'aws') {
    await awsRemoveDetachedWorker({
      workerName,
      projectRoot,
      targetEnv,
      credentials: ctx.credentials as AWSCredentials,
    });
  } else if (provider === 'azure') {
    await azureRemoveDetachedWorker({
      workerName,
      projectName,
      targetEnv,
      credentials: ctx.credentials as AzureCredentials,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:remove-detached-worker',
      'Supported providers: gcp, aws, azure',
    );
  }

  logger.newline();
  logger.success(`Worker "${workerName}" removed from ${targetEnv}`);
  logger.newline();
}
