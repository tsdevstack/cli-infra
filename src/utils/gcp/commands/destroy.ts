/**
 * GCP Destroy Handler
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import {
  buildGcpTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import {
  executeTerraform,
  isCloudRunSubnetReleasePending,
  isServiceNetworkingReleasePending,
} from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { getTerraformErrors } from '../../terraform';
import { disableDeletionProtection } from '../disable-deletion-protection';
import {
  deleteEnvironmentCloudRunResources,
  getEnvironmentCloudRunNames,
} from '../delete';
import type { FrameworkService } from '@tsdevstack/cli/plugin';
import type { GCPCommandContext, DestroyOptions } from './types';

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
 * Destroy GCP infrastructure
 */
export async function gcpDestroy(
  ctx: GCPCommandContext,
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
  logger.info(`GCP Project: ${ctx.credentials.project_id}`);
  logger.info(`Region: ${ctx.credentials.region}`);
  logger.newline();

  const hasDatabase = projectHasDatabase();

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    logger.warn('This will DESTROY all infrastructure resources!');
    logger.newline();

    if (hasDatabase) {
      logger.warn(
        'This includes the PostgreSQL database instance (ALL databases for ALL services).',
      );
      logger.warn('DATABASE DATA WILL BE PERMANENTLY LOST.');
      logger.newline();
      logger.info('Back up your databases before proceeding:');
      logger.info(
        `  Console: https://console.cloud.google.com/sql/instances/${ctx.projectName}-postgres/backups`,
      );
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
    const instanceName = `${ctx.projectName}-postgres`;
    logger.info('Disabling database deletion protection...');

    const result = await disableDeletionProtection({
      instanceName,
      projectId: ctx.credentials.project_id,
      credentials: ctx.credentials,
    });

    if (!result.success) {
      throw new CliError(
        `Failed to disable deletion protection: ${result.error}`,
        'infra:destroy',
        'Disable deletion protection manually via Cloud Console, then retry',
      );
    }

    if (result.wasAlreadyDisabled) {
      logger.info('  Deletion protection already disabled.');
    } else {
      logger.info('  Deletion protection disabled.');
    }
    logger.newline();
  }

  // Cloud Run services and jobs: deploys create them with the SDK, so
  // Terraform does not delete them. Left running they keep billing and keep
  // the subnet in use.
  const { loadFrameworkConfig } = getContext();
  let services: FrameworkService[] = [];
  try {
    services = loadFrameworkConfig().services;
  } catch {
    // No framework config: only Kong's name is known
  }
  logger.info('Deleting Cloud Run services and jobs...');
  const cloudRun = await deleteEnvironmentCloudRunResources({
    credentials: ctx.credentials,
    projectId: ctx.credentials.project_id,
    region: ctx.credentials.region,
    names: getEnvironmentCloudRunNames(services, ctx.projectName),
  });
  for (const name of cloudRun.deleted) {
    logger.success(`  Deleted ${name}`);
  }
  if (cloudRun.deleted.length === 0 && cloudRun.failed.length === 0) {
    logger.info('  None found.');
  }
  if (cloudRun.failed.length > 0) {
    throw new CliError(
      `Could not delete ${cloudRun.failed.map((f) => f.name).join(', ')}`,
      'infra:destroy',
      `${cloudRun.failed.map((f) => `${f.name}: ${f.error}`).join('; ')}. Run infra:destroy again; nothing else was deleted yet.`,
    );
  }
  logger.newline();

  // Build Terraform environment
  const tfEnv = buildGcpTerraformEnv(runtime, ctx.credentials);

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
    // Google frees the network of deleted services and databases late:
    // these errors clear by themselves
    const errors = getTerraformErrors(destroyResult.output);
    const releasePending = errors.filter(
      (error) =>
        isCloudRunSubnetReleasePending(error) ||
        isServiceNetworkingReleasePending(error),
    );
    const wait = `Google frees the network that the deleted services and database used only after a while (Cloud Run's subnet addresses: 1-2 hours). Run npx tsdevstack infra:destroy --env ${ctx.targetEnv} again later`;
    if (releasePending.length > 0 && releasePending.length === errors.length) {
      throw new CliError(
        'Google has not released the network yet',
        'infra:destroy',
        `${wait}; it removes what is left. Nothing left behind is billed.`,
      );
    }
    if (releasePending.length > 0) {
      throw new CliError(
        'Destroy failed',
        'infra:destroy',
        `Check the errors above. The network errors clear by themselves: ${wait}.`,
      );
    }
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
      '  Cloud SQL backups are retained for 7 days after instance deletion.',
    );
    logger.info('  Console: https://console.cloud.google.com/sql/backups');
    logger.newline();
  }
}
