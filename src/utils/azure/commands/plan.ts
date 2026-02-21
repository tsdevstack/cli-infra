/**
 * Azure Plan Handler
 *
 * Plans Azure infrastructure changes without applying them.
 */

import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { executeTerraform } from '../terraform';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import {
  buildAzureTerraformEnv,
  checkTerraformInstalled,
  extractLockId,
} from '@tsdevstack/infra-core';
import type { AzureCommandContext, PlanOptions } from './types';

/**
 * Plan Azure infrastructure changes
 */
export async function azurePlan(
  ctx: AzureCommandContext,
  options: PlanOptions = {},
): Promise<void> {
  const { logger, CliError } = getContext();
  const runtime = buildRuntime();

  checkTerraformInstalled(runtime);

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`Subscription: ${ctx.credentials.subscriptionId}`);
  logger.info(`Location: ${ctx.credentials.location}`);
  logger.newline();

  // Ensure state backend exists
  logger.info('Ensuring state backend exists...');

  const backendResult = await createStateBackend({
    projectName: ctx.projectName,
    env: ctx.targetEnv,
    credentials: ctx.credentials,
  });

  if (!backendResult.success) {
    throw new CliError(
      `Failed to create state backend: ${backendResult.error}`,
      'infra:plan',
      'Check your Azure credentials and resource group permissions',
    );
  }

  if (backendResult.storageAccountCreated) {
    logger.success(
      `Created Storage Account: ${backendResult.storageAccountName}`,
    );
  } else {
    logger.success(
      `Storage Account exists: ${backendResult.storageAccountName}`,
    );
  }
  logger.newline();

  // Generate all Terraform files
  const { outputDir } = generateTerraformFiles(ctx, 'infra:plan');

  logger.complete('Configuration generated');
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
      'infra:plan',
      initResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.info('Planning changes...');
  logger.newline();

  let planResult = await executeTerraform('plan', {
    workDir: outputDir,
    env: tfEnv,
  });

  // If plan failed and --force-unlock is set, try to unlock and retry
  if (!planResult.success && options.forceUnlock) {
    const lockId = extractLockId(planResult.output);

    if (lockId) {
      logger.newline();
      logger.warn('State lock detected, force unlocking...');
      logger.info(`Lock ID: ${lockId}`);
      logger.newline();

      const unlockResult = await executeTerraform('force-unlock', {
        workDir: outputDir,
        env: tfEnv,
        lockId,
      });

      if (!unlockResult.success) {
        throw new CliError(
          'Force unlock failed',
          'infra:plan',
          unlockResult.error || 'Check the output above for details',
        );
      }

      logger.success('State lock released, retrying plan...');
      logger.newline();

      planResult = await executeTerraform('plan', {
        workDir: outputDir,
        env: tfEnv,
      });
    }
  }

  if (!planResult.success) {
    throw new CliError(
      'Planning failed',
      'infra:plan',
      planResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.info('To apply these changes, run:');
  logger.info(`  npx tsdevstack infra:deploy --env ${ctx.targetEnv}`);
  logger.newline();
}
