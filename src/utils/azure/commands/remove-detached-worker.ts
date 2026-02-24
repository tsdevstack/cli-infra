/**
 * Azure Remove Detached Worker
 *
 * Removes an orphaned worker from Azure Container Apps.
 * Also provides interactive worker selection using discovery module.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { deleteContainerApp } from '../delete';
import { listContainerApps } from '../discovery';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

interface AzureRemoveDetachedWorkerParams {
  workerName: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

export async function azureRemoveDetachedWorker(
  params: AzureRemoveDetachedWorkerParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { workerName, projectName, targetEnv, credentials } = params;

  const resourceGroupName = `${projectName}-${targetEnv}-rg`;
  const containerAppName = `${projectName}-${workerName}`;

  // Delete Container App
  logger.info('Deleting Container App...');

  const result = await deleteContainerApp({
    credentials,
    resourceGroupName,
    containerAppName,
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

/**
 * Interactive worker selection for Azure
 */
export async function selectWorkerInteractiveAzure(
  credentials: AzureCredentials,
  projectName: string,
  targetEnv: string,
): Promise<string> {
  const { CliError } = getContext();

  const resourceGroupName = `${projectName}-${targetEnv}-rg`;

  const result = await listContainerApps({
    credentials,
    resourceGroupName,
    projectName,
  });

  if (!result.success) {
    throw new CliError(
      'Failed to list Container Apps',
      'infra:remove-detached-worker',
      result.error || 'Check your Azure credentials',
    );
  }

  // Filter to workers (names ending with -worker)
  const workers = result.apps.filter((app) => app.name.endsWith('-worker'));

  if (workers.length === 0) {
    throw new CliError(
      'No workers found',
      'infra:remove-detached-worker',
      'No Container Apps with -worker suffix found in the resource group',
    );
  }

  const prefix = `${projectName}-`;

  const { workerName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'workerName',
      message: 'Select worker to remove:',
      choices: workers.map((w) => {
        const shortName = w.name.startsWith(prefix)
          ? w.name.slice(prefix.length)
          : w.name;
        return {
          name: `${shortName} (${w.status})`,
          value: shortName,
        };
      }),
    },
  ]);

  return workerName;
}
