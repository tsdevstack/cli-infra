/**
 * AWS Destroy Handler
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { executeTerraform } from '../terraform';
import {
  buildAwsTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { disableDeletionProtection } from '../disable-deletion-protection';
import type { AWSCommandContext, DestroyOptions } from './types';

/**
 * Check if any service in the project has a database
 */
function projectHasDatabase(): boolean {
  const { loadFrameworkConfig } = getContext();
  try {
    const config = loadFrameworkConfig();
    return config.services.some((s) => s.hasDatabase);
  } catch {
    return false;
  }
}

/**
 * Destroy AWS infrastructure
 */
export async function awsDestroy(
  ctx: AWSCommandContext,
  options: DestroyOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  const runtime = buildRuntime();
  checkTerraformInstalled(runtime);

  const outputDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );

  if (!fs.existsSync(outputDir)) {
    throw new CliError(
      `Configuration directory not found: ${outputDir}`,
      'infra:destroy',
      'Run: npx tsdevstack infra:deploy first to create infrastructure',
    );
  }

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`AWS Region: ${ctx.credentials.region}`);
  logger.newline();

  const hasDatabase = projectHasDatabase();

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    logger.warn('This will DESTROY all infrastructure resources!');
    logger.newline();

    if (hasDatabase) {
      logger.warn(
        'This includes the RDS PostgreSQL instance (ALL databases for ALL services).',
      );
      logger.warn('DATABASE DATA WILL BE PERMANENTLY LOST.');
      logger.newline();
      logger.info('Back up your databases before proceeding:');
      logger.info('  RDS Console → Snapshots → Create snapshot');
      logger.info('  Or use pg_dump for individual databases.');
      logger.newline();
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to destroy the ${ctx.targetEnv} environment?`,
        default: false,
      },
    ]);

    if (!confirm) {
      logger.info('Destroy cancelled by user');
      return;
    }
  }

  // Disable deletion protection before terraform destroy
  if (hasDatabase) {
    const instanceIdentifier = `${ctx.projectName}-db`;
    logger.info('Disabling database deletion protection...');

    const result = await disableDeletionProtection({
      instanceIdentifier,
      credentials: ctx.credentials,
    });

    if (!result.success) {
      throw new CliError(
        `Failed to disable deletion protection: ${result.error}`,
        'infra:destroy',
        'Disable deletion protection manually via RDS Console, then retry',
      );
    }

    if (result.wasAlreadyDisabled) {
      logger.info('  Deletion protection already disabled.');
    } else {
      logger.info('  Deletion protection disabled.');
    }
    logger.newline();
  }

  // Build Terraform environment
  const tfEnv = buildAwsTerraformEnv(runtime, ctx.credentials);

  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
    reconfigure: true,
  });

  if (!initResult.success) {
    throw new CliError(
      'Initialization failed',
      'infra:destroy',
      initResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.info('Destroying resources...');
  logger.newline();

  const destroyResult = await executeTerraform('destroy', {
    workDir: outputDir,
    autoApprove: true,
    env: tfEnv,
  });

  if (!destroyResult.success) {
    throw new CliError(
      'Destroy failed',
      'infra:destroy',
      destroyResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.success('Infrastructure destroyed successfully!');
  logger.newline();

  // Post-destroy recovery hints
  if (hasDatabase) {
    logger.info('Data recovery:');
    logger.info(
      `  Final snapshot: ${ctx.projectName}-db-final (RDS Console → Snapshots)`,
    );
    logger.info(
      '  Automated backups retained for the backup retention period.',
    );
    logger.newline();
  }
}
