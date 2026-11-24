/**
 * Azure Remove Service
 *
 * Removes a service's cloud resources from Azure.
 * Uses discovery to find resources and deletion utilities.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import {
  discoverServiceResources,
  discoverCoupledWorkers,
  discoverCoupledCronJobs,
} from '../discovery';
import {
  hasAnyResources,
  showResourceWarning,
  buildDeletionSteps,
  executeSteps,
  showFailureReport,
  getOtherEnvironments,
  selectServiceInteractive,
} from '../remove-service';
import type { AzureCommandContext } from './types';
import type {
  DeletionStepResult,
  ExecuteStepsResult,
} from '../remove-service/types';
import { liftDatabaseLock } from '../database-lock/lift-database-lock';
import { putDatabaseLock } from '../database-lock/put-database-lock';
import { logRemoveServiceNextSteps } from '../../display/log-remove-service-next-steps';
import { logDatabaseRecoveryHint } from '../../display/log-database-recovery-hint';
import { logDatabaseSavedHint } from '../../display/log-database-saved-hint';
import {
  buildAzureTerraformEnv,
  DB_EXPORT_REASONS,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { initTerraformBeforeChanges } from '../../terraform';
import { buildDbExportFileName } from '../../database-export/build-db-export-file-name';
import { saveDatabaseBeforeRemoval } from '../../database-export/save-database-before-removal';
import { getAzureDbExports } from '../database-export/get-azure-db-exports';
import { runAzureDatabaseJob } from '../database-export/run-azure-database-job';

export interface AzureRemoveServiceParams {
  serviceName: string | undefined;
  ctx: AzureCommandContext;
  runningInCI: boolean;
  dryRunOption: boolean | undefined;
  confirmOption: boolean | undefined;
  /** Remove without saving the database (--skip-export) */
  skipExportOption: boolean | undefined;
}

export interface AzureRemoveServiceResult {
  aborted: boolean;
  serviceName?: string;
}

/**
 * Remove a service from Azure cloud
 */
export async function azureRemoveService(
  params: AzureRemoveServiceParams,
): Promise<AzureRemoveServiceResult> {
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const { serviceName, ctx, runningInCI, dryRunOption } = params;
  // --confirm answers the questions, as in CI: delete, without typing the name
  const interactive = !runningInCI && params.confirmOption !== true;
  const skipExport = params.skipExportOption === true;

  const { credentials, projectName, targetEnv } = ctx;

  // In CI mode, service name is required
  if (!serviceName && runningInCI) {
    throw new CliError(
      'Service name required in CI mode',
      'infra:remove-service',
      'Specify service name as argument: infra:remove-service <service-name>',
    );
  }

  // If no service name provided, do interactive selection from deployed services
  let resolvedServiceName: string;
  if (!serviceName) {
    resolvedServiceName = await selectServiceInteractive({
      projectName,
      targetEnv,
      credentials,
    });
  } else {
    resolvedServiceName = serviceName;
  }

  logger.info(`Service: ${resolvedServiceName}`);
  logger.info(`Environment: ${targetEnv}`);
  logger.newline();

  // Discover resources from cloud (not from config)
  logger.info('Discovering cloud resources...');

  const discovered = await discoverServiceResources({
    serviceName: resolvedServiceName,
    projectName,
    targetEnv,
    credentials,
  });

  if (!hasAnyResources(discovered)) {
    logger.warn(
      `No cloud resources found for "${resolvedServiceName}" in ${targetEnv}`,
    );
    logger.info('Service may not be deployed to this environment.');
    return { aborted: true };
  }

  // Show discovered type
  if (discovered.inferredType !== 'unknown') {
    logger.info(`Detected type: ${discovered.inferredType}`);
  }

  // Discover coupled workers (workers with same base name)
  const coupledWorkers = await discoverCoupledWorkers({
    baseServiceName: resolvedServiceName,
    projectName,
    targetEnv,
    credentials,
  });

  // The service's cron jobs (Container App Jobs running its image)
  const coupledCronJobs = await discoverCoupledCronJobs({
    serviceName: resolvedServiceName,
    projectName,
    targetEnv,
    credentials,
  });

  logger.newline();

  // Ask about dry-run in interactive mode (if not already specified)
  let dryRun = dryRunOption;
  if (interactive && dryRun === undefined) {
    const { runMode } = await inquirer.prompt([
      {
        type: 'select',
        name: 'runMode',
        message: 'Select mode:',
        choices: [
          { name: 'Dry run (preview what would be deleted)', value: 'dry-run' },
          { name: 'Delete resources', value: 'delete' },
        ],
        default: 'dry-run',
      },
    ]);
    dryRun = runMode === 'dry-run';
  }

  // Show warning
  showResourceWarning({
    serviceName: resolvedServiceName,
    discovered,
    coupledWorkers,
    coupledCronJobs,
    targetEnv,
    dryRun,
    skipExport,
    logger,
  });

  // Dry run - stop here
  if (dryRun) {
    logger.newline();
    logger.info('Dry run complete. No resources were deleted.');
    logger.info('Run again and select "Delete resources" to proceed.');
    return { aborted: true };
  }

  // Final confirmation (interactive only)
  if (interactive) {
    const { confirmation } = await inquirer.prompt([
      {
        type: 'input',
        name: 'confirmation',
        message: `Type "${resolvedServiceName}" to confirm deletion:`,
      },
    ]);

    if (confirmation !== resolvedServiceName) {
      logger.info('Confirmation did not match. Aborted.');
      return { aborted: true };
    }
  }

  // The database step reads Terraform outputs: set up the folder first
  // (CI and other machines have no backend yet). Nothing is deleted if it
  // fails.
  await initTerraformBeforeChanges({
    projectRoot: ctx.projectRoot,
    targetEnv,
    env: buildAzureTerraformEnv(buildRuntime(), ctx.credentials),
  });

  // The database is saved to the exports container before it is dropped.
  // Terraform makes it at deploy: an environment last deployed with an
  // older CLI has none yet.
  const savesDatabase = discovered.hasDatabase && !skipExport;
  const exports = savesDatabase ? getAzureDbExports(ctx) : null;
  if (savesDatabase && !exports) {
    throw new CliError(
      'This environment has no storage for saved databases yet. Nothing was deleted.',
      'infra:remove-service',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first (it makes the storage), or add --skip-export to remove the service without saving its data.`,
    );
  }
  let savedFile: string | undefined;
  const saveDatabase = exports
    ? async (): Promise<DeletionStepResult> => {
        let file = '';
        const result = await saveDatabaseBeforeRemoval({
          interactive,
          save: () => {
            // A new name each try: a try that failed left no file
            file = buildDbExportFileName(
              resolvedServiceName,
              DB_EXPORT_REASONS.removed,
            );
            return runAzureDatabaseJob({
              ctx,
              mode: 'export',
              serviceName: resolvedServiceName,
              file,
            });
          },
        });
        if (result.outcome === 'saved') {
          savedFile = file;
          return { success: true, deleted: true };
        }
        if (result.outcome === 'skipped') {
          return { success: true, deleted: false };
        }
        return { success: false, deleted: false, error: result.error };
      }
    : undefined;

  // Execute deletion
  logger.newline();
  logger.info('Deleting resources...');
  logger.newline();

  const steps = buildDeletionSteps({
    ctx,
    serviceName: resolvedServiceName,
    discovered,
    projectName,
    targetEnv,
    coupledWorkers,
    coupledCronJobs,
    saveDatabase,
  });

  // The delete lock on the database server covers its databases: lift it
  // before anything is deleted, put it back after the steps, also when one
  // fails. Without a lock (deletionProtection false) nothing changes.
  const lockTarget = {
    credentials,
    resourceGroupName: `${projectName}-${targetEnv}-rg`,
    serverName: discovered.postgresServerName,
  };
  let lockLifted = false;
  if (discovered.hasDatabase) {
    try {
      lockLifted = await liftDatabaseLock(lockTarget);
    } catch (error) {
      throw new CliError(
        `Could not lift the delete lock on the database server ${lockTarget.serverName}: ${error instanceof Error ? error.message : String(error)}`,
        'infra:remove-service',
        'Nothing was deleted. Locks need the User Access Administrator role on the resource group (Azure account setup, step 5).',
      );
    }
  }

  let result: ExecuteStepsResult;
  try {
    result = await executeSteps(logger, steps);
  } finally {
    if (lockLifted) {
      try {
        await putDatabaseLock(lockTarget);
        logger.info('  Put the delete lock back on the database server');
      } catch (error) {
        logger.warn(
          `Could not put the delete lock back on the database server ${lockTarget.serverName}: ${error instanceof Error ? error.message : String(error)}. The next infra:deploy puts it back.`,
        );
      }
    }
  }
  const { completed, failed, remaining } = result;

  // Show results
  logger.newline();
  if (failed) {
    showFailureReport(logger, completed, failed, remaining);
    throw new CliError(
      `Failed at: ${failed.name}`,
      'infra:remove-service',
      'Re-run the command to retry (deletes are idempotent)',
    );
  }

  // Success message
  logger.newline();
  logger.success(
    `✔ Service "${resolvedServiceName}" removed from ${targetEnv}`,
  );
  logger.newline();

  // Where the database's data is now
  if (savedFile && exports) {
    logDatabaseSavedHint(
      resolvedServiceName,
      targetEnv,
      `${exports.containerUrl}/${savedFile}`,
    );
  } else if (discovered.hasDatabase) {
    logDatabaseRecoveryHint(resolvedServiceName, {
      server: 'the shared PostgreSQL Flexible Server',
      backups: "the server's backups (35 days with backup on, 7 without)",
      restore:
        'restore the server to a time just before the removal (point-in-time restore, into a new server)',
      links: ['Portal: PostgreSQL Flexible Server → Backups → Restore'],
    });
  }

  // Check if service is in config.json
  let isInConfig = false;
  try {
    const config = loadFrameworkConfig();
    isInConfig = config.services.some((s) => s.name === resolvedServiceName);
  } catch {
    // Config might not exist
  }

  // Show next steps
  const otherEnvs = getOtherEnvironments(ctx);

  if (isInConfig) {
    if (otherEnvs.length > 0) {
      logger.info('Other environments where service may still be deployed:');
      for (const env of otherEnvs) {
        logger.info(
          `  • npx tsdevstack infra:remove-service ${resolvedServiceName} --env ${env}`,
        );
      }
      logger.newline();
    }

    logRemoveServiceNextSteps(resolvedServiceName, targetEnv);
  } else {
    if (otherEnvs.length > 0) {
      logger.info('Check if service exists in other environments:');
      for (const env of otherEnvs) {
        logger.info(
          `  • npx tsdevstack infra:service-status ${resolvedServiceName} --env ${env}`,
        );
      }
      logger.newline();
    }

    logger.info(
      'Service was not in config.json (already removed or never added).',
    );
    logger.info(
      'Cloud resources have been cleaned up. No local changes needed.',
    );
  }

  return { aborted: false, serviceName: resolvedServiceName };
}
