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
import { executeTerraform } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import type { GCPCommandContext, DestroyOptions } from './types';

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

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    logger.warn('This will DESTROY all infrastructure resources!');
    logger.newline();

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

  // Build Terraform environment
  const tfEnv = buildGcpTerraformEnv(runtime, ctx.credentials);

  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
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
}
