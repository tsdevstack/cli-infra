/**
 * Sync Terraform State
 *
 * Sync Terraform state after deleting resources.
 * Uses pre-fetched passwords passed as parameter.
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../../../context';
import { buildGcpTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { runTerraform } from './run-terraform';
import type { GCPCommandContext } from '../commands/types';

/**
 * Sync Terraform state after deleting resources
 * Uses pre-fetched passwords passed as parameter
 *
 * @param ctx - Infrastructure command context
 * @param dbPasswords - Pre-fetched database passwords (TF var suffix -> password)
 */
export async function syncTerraformState(
  ctx: GCPCommandContext,
  dbPasswords: Record<string, string>,
): Promise<void> {
  const { projectRoot, targetEnv, credentials } = ctx;
  const { logger } = getContext();

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

  // Build Terraform environment
  const runtime = buildRuntime();
  const tfEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...buildGcpTerraformEnv(runtime, credentials),
  };

  // Inject pre-fetched database passwords
  for (const [tfVarSuffix, password] of Object.entries(dbPasswords)) {
    tfEnv[`TF_VAR_db_${tfVarSuffix}_password`] = password;
  }

  logger.info(
    `  Using ${Object.keys(dbPasswords).length} pre-fetched database password(s)`,
  );

  try {
    // Initialize Terraform (required in CI where .terraform doesn't exist)
    logger.info('  Running terraform init...');
    await runTerraform(
      ['init', '-input=false', '-reconfigure'],
      terraformDir,
      tfEnv,
    );

    // Plan refresh-only
    logger.info('  Running terraform plan -refresh-only...');
    await runTerraform(
      ['plan', '-refresh-only', '-out=refresh.plan', '-input=false'],
      terraformDir,
      tfEnv,
    );

    // Apply the refresh
    logger.info('  Running terraform apply (refresh)...');
    await runTerraform(
      ['apply', '-input=false', 'refresh.plan'],
      terraformDir,
      tfEnv,
    );

    logger.success('  ✔ Terraform state synced');
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
