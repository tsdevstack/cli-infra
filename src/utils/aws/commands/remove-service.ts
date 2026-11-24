/**
 * AWS Remove Service
 *
 * Removes a service's cloud resources from AWS.
 * Uses discovery to find resources and deletion utilities.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import {
  discoverServiceResources,
  discoverCoupledWorkers,
  discoverAwsCronJobs,
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
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import type { AWSCommandContext } from './types';
import { logRemoveServiceNextSteps } from '../../display/log-remove-service-next-steps';
import { logDatabaseRecoveryHint } from '../../display/log-database-recovery-hint';
import { logDatabaseSavedHint } from '../../display/log-database-saved-hint';
import {
  buildAwsTerraformEnv,
  DB_EXPORT_REASONS,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { initTerraformBeforeChanges } from '../../terraform';
import { buildDbExportFileName } from '../../database-export/build-db-export-file-name';
import { saveDatabaseBeforeRemoval } from '../../database-export/save-database-before-removal';
import { getAwsDbExportsBucket } from '../database-export/get-aws-db-exports-bucket';
import { runAwsDatabaseJob } from '../database-export/run-aws-database-job';
import type { DeletionStepResult } from '../remove-service/types';

export interface AwsRemoveServiceParams {
  serviceName: string | undefined;
  ctx: AWSCommandContext;
  runningInCI: boolean;
  dryRunOption: boolean | undefined;
  confirmOption: boolean | undefined;
  /** Remove without saving the database (--skip-export) */
  skipExportOption: boolean | undefined;
}

export interface AwsRemoveServiceResult {
  aborted: boolean;
  serviceName?: string;
}

/**
 * Remove a service from AWS cloud
 */
export async function awsRemoveService(
  params: AwsRemoveServiceParams,
): Promise<AwsRemoveServiceResult> {
  const { logger, CliError, loadFrameworkConfig, buildSecretName } =
    getContext();
  const { serviceName, ctx, runningInCI, dryRunOption } = params;
  // --confirm answers the questions, as in CI: delete, without typing the name
  const interactive = !runningInCI && params.confirmOption !== true;
  const skipExport = params.skipExportOption === true;

  const credentials = ctx.credentials as AWSCredentials;
  const { projectName, targetEnv } = ctx;

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
    serviceName: resolvedServiceName,
    projectName,
    targetEnv,
    credentials,
  });

  // The service's cron jobs, by their task definitions' tags
  const coupledCronJobs = (
    await discoverAwsCronJobs({ projectName, credentials }).catch(
      (error: unknown) => {
        throw new CliError(
          "Could not list the cron jobs' task definitions",
          'infra:remove-service',
          `${error instanceof Error ? error.message : String(error)}. Nothing was deleted; run the command again.`,
        );
      },
    )
  ).filter((job) => job.serviceName === resolvedServiceName);
  if (coupledCronJobs.length > 0) {
    logger.info(`Cron jobs: ${coupledCronJobs.map((j) => j.name).join(', ')}`);
  }

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

  // A running service may have a database (db-delete skips what isn't
  // there). Its DATABASE_URL secret goes last, so a rerun after the service
  // was deleted still runs the database step.
  const hasDatabaseUrl = discovered.secrets.includes(
    buildSecretName(projectName, resolvedServiceName, 'DATABASE_URL'),
  );
  const hasDatabase = discovered.inferredType === 'backend' || hasDatabaseUrl;
  // RDS has no list of a server's databases: db-init writes DATABASE_URL
  // right after it makes the database, so only then is there one to save
  // (a backend without a database has none)
  const savesDatabase = hasDatabaseUrl && !skipExport;

  // Show warning
  showResourceWarning({
    serviceName: resolvedServiceName,
    discovered,
    coupledWorkers,
    coupledCronJobs,
    targetEnv,
    dryRun,
    databaseSaved: savesDatabase,
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
    env: buildAwsTerraformEnv(buildRuntime(), credentials),
  });

  // The database is saved to the exports bucket before it is dropped.
  // Terraform makes the bucket at deploy: an environment last deployed with
  // an older CLI has none yet.
  const exportsBucket = savesDatabase ? getAwsDbExportsBucket(ctx) : null;
  if (savesDatabase && !exportsBucket) {
    throw new CliError(
      'This environment has no bucket for saved databases yet. Nothing was deleted.',
      'infra:remove-service',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first (it makes the bucket), or add --skip-export to remove the service without saving its data.`,
    );
  }
  let savedFile: string | undefined;
  const saveDatabase = exportsBucket
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
            return runAwsDatabaseJob({
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
    hasDatabase,
    saveDatabase,
  });
  const { completed, failed, remaining } = await executeSteps(logger, steps);

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
  if (savedFile && exportsBucket) {
    logDatabaseSavedHint(
      resolvedServiceName,
      targetEnv,
      `s3://${exportsBucket}/${savedFile}`,
    );
  } else if (hasDatabase) {
    logDatabaseRecoveryHint(resolvedServiceName, {
      server: 'the shared RDS instance',
      backups: "the instance's backups (7 days, if backup is on)",
      restore:
        'restore the instance to a time just before the removal (point-in-time restore, into a new instance)',
      links: ['Console: RDS → Automated backups'],
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
