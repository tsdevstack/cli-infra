/**
 * GCP Remove Detached Worker
 *
 * Removes an orphaned worker from Cloud Run.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { discoverDeployedServices } from '../discovery';
import { deleteCloudRunService } from '../delete';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

interface GcpRemoveDetachedWorkerParams {
  workerName: string;
  credentials: GCPCredentials;
}

/**
 * Remove a detached worker from Cloud Run
 */
export async function gcpRemoveDetachedWorker(
  params: GcpRemoveDetachedWorkerParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { workerName, credentials } = params;

  logger.info('Deleting Cloud Run service...');

  const result = await deleteCloudRunService({
    serviceName: workerName,
    projectId: credentials.project_id,
    region: credentials.region,
    credentials,
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
 * Interactively select a worker from deployed workers in GCP
 */
export async function selectWorkerInteractiveGcp(
  credentials: GCPCredentials,
  projectName: string,
): Promise<string> {
  const { logger, CliError } = getContext();

  logger.info('Discovering deployed workers...');
  logger.newline();

  const sqlInstanceName = `${projectName}-postgres`;

  // Discover deployed services
  const discoveryResult = await discoverDeployedServices({
    projectName,
    projectId: credentials.project_id,
    region: credentials.region,
    sqlInstanceName,
    credentials,
  });

  if (!discoveryResult.success) {
    throw new CliError(
      'Failed to discover deployed services',
      'infra:remove-detached-worker',
      discoveryResult.error || 'Check cloud credentials',
    );
  }

  // Filter to workers only (services ending with -worker)
  const workers = discoveryResult.services.filter((s) =>
    s.name.endsWith('-worker'),
  );

  if (workers.length === 0) {
    throw new CliError(
      'No deployed workers found',
      'infra:remove-detached-worker',
      'No Cloud Run services ending with "-worker" found',
    );
  }

  // Build choices
  const choices = workers.map((w) => ({
    name: w.name,
    value: w.name,
  }));

  // Add manual entry option
  choices.push({
    name: '[ Enter worker name manually ]',
    value: '__manual__',
  });

  const { selectedWorker } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedWorker',
      message: 'Select worker to remove:',
      choices,
    },
  ]);

  // If manual entry selected, prompt for name
  if (selectedWorker === '__manual__') {
    const { enteredWorkerName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'enteredWorkerName',
        message: 'Enter worker name to remove:',
        validate: (input: string) => {
          if (!input || !input.trim()) {
            return 'Worker name is required';
          }
          if (!input.trim().endsWith('-worker')) {
            return 'Worker name must end with "-worker"';
          }
          return true;
        },
      },
    ]);
    return enteredWorkerName.trim();
  }

  return selectedWorker;
}
