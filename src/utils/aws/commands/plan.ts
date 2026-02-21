/**
 * AWS Plan Handler
 *
 * Plans AWS infrastructure changes without applying them.
 * Shows what resources will be created/modified/destroyed.
 */

import { getContext } from '../../../context';
import { executeTerraform } from '../terraform';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import {
  buildAwsTerraformEnv,
  checkTerraformInstalled,
  extractLockId,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCommandContext, PlanOptions } from './types';

/**
 * Plan AWS infrastructure changes
 */
export async function awsPlan(
  ctx: AWSCommandContext,
  options: PlanOptions = {},
): Promise<void> {
  const { logger, CliError } = getContext();

  const runtime = buildRuntime();
  checkTerraformInstalled(runtime);

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`AWS Account: ${ctx.credentials.accountId}`);
  logger.info(`Region: ${ctx.credentials.region}`);
  logger.newline();

  // Ensure state backend exists (S3 + DynamoDB)
  logger.info('Ensuring state backend exists...');

  const backendResult = await createStateBackend({
    projectName: ctx.projectName,
    accountId: ctx.credentials.accountId,
    credentials: ctx.credentials,
  });

  if (!backendResult.success) {
    throw new CliError(
      `Failed to create state backend: ${backendResult.error}`,
      'infra:plan',
      'Check your AWS credentials and permissions',
    );
  }

  if (backendResult.bucketCreated) {
    logger.success(`  ✓ Created S3 bucket: ${backendResult.bucketName}`);
  } else {
    logger.success(`  ✓ S3 bucket exists: ${backendResult.bucketName}`);
  }

  if (backendResult.tableCreated) {
    logger.success(`  ✓ Created DynamoDB table: ${backendResult.tableName}`);
  } else {
    logger.success(`  ✓ DynamoDB table exists: ${backendResult.tableName}`);
  }
  logger.newline();

  // Generate all Terraform files using shared function
  const { outputDir } = generateTerraformFiles(ctx, 'infra:plan');

  logger.complete('Configuration generated');
  logger.newline();

  // Build Terraform environment
  const tfEnv = buildAwsTerraformEnv(runtime, ctx.credentials);

  // For AWS, database passwords are managed via Secrets Manager
  // Terraform generates them with random_password and stores them there
  // No need to pass TF_VAR_db_*_password from external sources

  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
    reconfigure: true, // Handle backend changes (e.g., switching from GCP to AWS)
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

      // Retry plan
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
