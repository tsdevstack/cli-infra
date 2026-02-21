/**
 * Sync Terraform State (Azure)
 *
 * Sync Terraform state after deleting resources.
 * Uses pre-fetched passwords passed as parameter.
 */

import path from 'node:path';
import fs from 'node:fs';
import { runTerraform } from './run-terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCommandContext } from '../commands/types';
import { getContext } from '../../../context';

/**
 * Sync Terraform state with current cloud resources
 */
export async function syncTerraformState(
  ctx: AzureCommandContext,
  dbPasswords: Record<string, string>,
): Promise<void> {
  const { logger, findProjectRoot } = getContext();
  const { targetEnv, credentials } = ctx;
  const projectRoot = findProjectRoot();

  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  if (!fs.existsSync(terraformDir)) {
    logger.info('  Terraform directory not found, skipping state sync');
    return;
  }

  // Build Terraform environment with Azure credentials
  const tfVars: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...buildAzureTerraformEnv(buildRuntime(), credentials),
  };

  // Add DB password variables
  for (const [serviceName, password] of Object.entries(dbPasswords)) {
    // Convert service name to TF variable format: test-service -> test_service
    const tfVarName = `TF_VAR_db_${serviceName.replace(/-/g, '_')}_password`;
    tfVars[tfVarName] = password;
  }

  logger.info(
    `  Using ${Object.keys(dbPasswords).length} pre-fetched database password(s)`,
  );

  try {
    // Initialize Terraform (required in CI where .terraform doesn't exist)
    logger.info('  Running terraform init...');
    await runTerraform(['init', '-input=false'], terraformDir, tfVars);

    // Plan refresh-only
    logger.info('  Running terraform plan -refresh-only...');
    await runTerraform(
      ['plan', '-refresh-only', '-out=refresh.plan', '-input=false'],
      terraformDir,
      tfVars,
    );

    // Apply the refresh
    logger.info('  Running terraform apply (refresh)...');
    await runTerraform(
      ['apply', '-input=false', 'refresh.plan'],
      terraformDir,
      tfVars,
    );

    logger.success('  Terraform state synced');
  } catch (error) {
    logger.warn(
      `Terraform state sync failed: ${error instanceof Error ? error.message : 'Unknown'}`,
    );
    logger.info(
      '  You may need to run "terraform plan -refresh-only" manually',
    );
    throw error; // Re-throw so step shows as warning
  }
}
