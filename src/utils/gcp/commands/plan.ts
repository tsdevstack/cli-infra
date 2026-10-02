/**
 * GCP Plan Handler
 */

import { getContext } from '../../../context';
import {
  buildGcpTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import { executeTerraform } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { toTfVarSuffix } from '../../terraform';
import { createBucket } from '../create-bucket';
import { getGcsLocationFromRegion } from '../get-gcs-location-from-region';
import { fetchDbPasswordsFromSecretManager } from '../../credentials/fetch-db-passwords-from-secret-manager';
import { generateTerraformFiles } from './generate-terraform-files';
import type { GCPCommandContext } from './types';

/**
 * Plan GCP infrastructure changes
 */
export async function gcpPlan(ctx: GCPCommandContext): Promise<void> {
  const { logger, CliError } = getContext();
  const runtime = buildRuntime();

  checkTerraformInstalled(runtime);

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`GCP Project: ${ctx.credentials.project_id}`);
  logger.info(`Region: ${ctx.credentials.region}`);
  logger.newline();

  // Ensure state bucket exists
  const stateBucket = `${ctx.projectName}-tf-state-${ctx.credentials.project_id}`;
  logger.info(`Ensuring state bucket exists: ${stateBucket}`);

  const bucketResult = await createBucket({
    bucketName: stateBucket,
    credentials: ctx.credentials,
    location: getGcsLocationFromRegion(ctx.credentials.region),
    versioning: true,
    labels: {
      purpose: 'tf-state',
      environment: ctx.targetEnv,
    },
  });

  if (!bucketResult.success) {
    throw new CliError(
      `Failed to create state bucket: ${bucketResult.error}`,
      'infra:plan',
      'Check your GCP credentials and permissions',
    );
  }

  if (bucketResult.isNew) {
    logger.success(`  ✓ Created bucket: ${stateBucket}`);
  } else {
    logger.success(`  ✓ Bucket exists: ${stateBucket}`);
  }
  logger.newline();

  // Generate all Terraform files using shared function
  const { outputDir, servicesWithDatabase } = generateTerraformFiles(
    ctx,
    'infra:plan',
  );

  logger.complete('Configuration generated');
  logger.newline();

  // Build Terraform environment
  const tfEnv = buildGcpTerraformEnv(runtime, ctx.credentials);

  // Load database passwords
  const servicesWithDb = servicesWithDatabase.filter((s) => s.hasDatabase);
  let dbPasswords: Record<string, string> = {};

  if (servicesWithDb.length > 0) {
    logger.info('Loading database passwords...');

    // Always fetch from Secret Manager (works in both local and CI with WIF)
    dbPasswords = await fetchDbPasswordsFromSecretManager(
      ctx.targetEnv,
      servicesWithDb,
    );
    logger.success('  ✓ Loaded from Secret Manager');
    logger.newline();
  }

  // Add database passwords as TF_VAR_db_{prefix}_password
  for (const [serviceName, password] of Object.entries(dbPasswords)) {
    const suffix = toTfVarSuffix(serviceName);
    tfEnv[`TF_VAR_db_${suffix}_password`] = password;
  }

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

  const planResult = await executeTerraform('plan', {
    workDir: outputDir,
    env: tfEnv,
  });

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
