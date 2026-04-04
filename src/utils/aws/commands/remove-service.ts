/**
 * AWS Remove Service
 *
 * Removes a service's cloud resources from AWS.
 * Uses discovery to find resources and deletion utilities.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { discoverServiceResources, discoverCoupledWorkers } from '../discovery';
import {
  hasAnyResources,
  showResourceWarning,
  buildDeletionSteps,
  executeSteps,
  showFailureReport,
  fetchAllDbPasswords,
  getOtherEnvironments,
  selectServiceInteractive,
} from '../remove-service';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import type { AWSCommandContext } from './types';

export interface AwsRemoveServiceParams {
  serviceName: string | undefined;
  ctx: AWSCommandContext;
  runningInCI: boolean;
  dryRunOption: boolean | undefined;
  confirmOption: boolean | undefined;
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
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const { serviceName, ctx, runningInCI, dryRunOption } = params;

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

  logger.newline();

  // Ask about dry-run in interactive mode (if not already specified)
  let dryRun = dryRunOption;
  if (!runningInCI && dryRun === undefined) {
    const { runMode } = await inquirer.prompt([
      {
        type: 'list',
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
    targetEnv,
    dryRun,
    logger,
  });

  // Dry run - stop here
  if (dryRun) {
    logger.newline();
    logger.info('Dry run complete. No resources were deleted.');
    logger.info('Run again and select "Delete resources" to proceed.');
    return { aborted: true };
  }

  // Database backup prompt (interactive only)
  const hasDatabase = discovered.inferredType === 'backend'; // Rough heuristic
  if (hasDatabase && !runningInCI) {
    logger.newline();
    logger.warn('BACKUP YOUR DATABASE before proceeding!');
    logger.newline();
    logger.info('  Use AWS RDS snapshot or pg_dump');
    logger.newline();

    const { backedUp } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'backedUp',
        message: 'Have you backed up the database?',
        default: false,
      },
    ]);

    if (!backedUp) {
      logger.info('Aborted. Please back up your database first.');
      return { aborted: true };
    }
  }

  // Final confirmation (interactive only)
  if (!runningInCI) {
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

  // Pre-fetch ALL database passwords BEFORE deleting anything
  logger.info('Fetching database passwords for Terraform...');
  const dbPasswords = await fetchAllDbPasswords({
    projectName,
    credentials,
  });
  logger.info(
    `  Found ${Object.keys(dbPasswords).length} database password(s)`,
  );

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
    dbPasswords,
    coupledWorkers,
    hasDatabase,
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

  // Database recovery hints (if database was removed)
  if (hasDatabase) {
    logger.info(
      `Database "${resolvedServiceName}" has been dropped from the shared RDS instance.`,
    );
    logger.newline();
    logger.info('Data recovery options:');
    logger.info('  RDS automated backups are retained for 7 days.');
    logger.info('  Console: RDS → Automated backups');
    logger.info(
      '  Point-in-time restore: aws rds restore-db-instance-to-point-in-time',
    );
    logger.info(
      '  Note: Restoring creates a NEW instance — you will need to extract the specific database.',
    );
    logger.newline();
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

    logger.info('Next steps:');
    logger.info(`  1. Remove from other environments (if deployed)`);
    logger.info(
      `  2. npx tsdevstack remove-service ${resolvedServiceName}  # removes from config.json`,
    );
    logger.info(
      `  3. npx tsdevstack sync                                  # regenerates files`,
    );
    logger.info(
      `  4. npx tsdevstack infra:deploy-kong --env ${targetEnv}  # updates Kong routes`,
    );
    logger.newline();

    logger.warn(
      'Kong routes for this service will return 502 until Kong is redeployed.',
    );
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
