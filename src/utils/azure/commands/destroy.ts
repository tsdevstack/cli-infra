/**
 * Azure Destroy Handler
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { executeTerraform } from '../terraform';
import {
  buildAzureTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import { deleteEnvironmentContainerResources } from '../delete/delete-environment-container-resources';
import type { AzureCommandContext, DestroyOptions } from './types';

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
 * Destroy Azure infrastructure
 */
export async function azureDestroy(
  ctx: AzureCommandContext,
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
  logger.info(`Location: ${ctx.credentials.location}`);
  logger.newline();

  const hasDatabase = projectHasDatabase();

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    logger.warn('This will DESTROY all infrastructure resources!');
    logger.newline();

    if (hasDatabase) {
      logger.warn(
        'This includes the PostgreSQL Flexible Server (ALL databases for ALL services).',
      );
      logger.warn('DATABASE DATA WILL BE PERMANENTLY LOST.');
      logger.newline();
      logger.info('Back up your databases before proceeding:');
      logger.info('  Portal: PostgreSQL Flexible Server → Backups');
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

  // Note: Azure PostgreSQL Flexible Server does not have a deletion_protection flag.
  // Protection is handled via resource locks (out of scope for now).

  // Container Apps and migration jobs come from deploys (SDK), not Terraform,
  // and Azure will not delete their managed environment while they exist
  logger.info(
    'Removing Container Apps and migration jobs created by deploys...',
  );
  const containerResources = await deleteEnvironmentContainerResources({
    credentials: ctx.credentials,
    resourceGroupName: `${ctx.projectName}-${ctx.targetEnv}-rg`,
    environmentName: `${ctx.projectName}-${ctx.targetEnv}-cae`,
  });
  for (const name of containerResources.deleted) {
    logger.success(`  Deleted ${name}`);
  }
  if (containerResources.failed.length > 0) {
    throw new CliError(
      `Could not delete ${containerResources.failed.map((f) => f.name).join(', ')}`,
      'infra:destroy',
      `${containerResources.failed.map((f) => `${f.name}: ${f.error}`).join('; ')}. Terraform cannot delete the Container Apps environment while they exist; run infra:destroy again.`,
    );
  }
  logger.newline();

  // Build Terraform environment
  const tfEnv = buildAzureTerraformEnv(runtime, ctx.credentials);

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
      '  Backups retained for the configured retention period (7-35 days).',
    );
    logger.info('  Portal: PostgreSQL Flexible Server → Deleted servers');
    logger.newline();
  }
}
