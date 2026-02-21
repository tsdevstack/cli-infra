/**
 * Deploy SPA to AWS (S3 + CloudFront)
 *
 * Orchestrates the complete SPA deployment workflow:
 * 1. Build the SPA with environment variables
 * 2. Upload files to S3 bucket
 * 3. Invalidate CloudFront cache
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getContext } from '../../../context';
import { getTerraformOutput } from '../terraform';
import {
  buildAwsTerraformEnv,
  invalidateCloudfront,
  uploadSpaToS3,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { fetchServiceSecrets } from '../../deploy/fetch-service-secrets';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface DeploySpaAwsOptions {
  projectRoot: string;
  targetEnv: string;
  credentials: AWSCredentials;
  service: { name: string; type: string };
}

/**
 * Deploy an SPA service to S3 + CloudFront
 */
export async function deploySpaAws(
  options: DeploySpaAwsOptions,
): Promise<void> {
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const { projectRoot, targetEnv, credentials, service } = options;

  logger.info('Deploying SPA to S3 + CloudFront...');
  logger.newline();

  // Validate terraform directory
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'deploy-spa-aws',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Build Terraform environment
  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);

  // Get bucket name from terraform output
  // Terraform output key format: {service_name}_spa_bucket (underscores)
  const bucketOutputKey = `${service.name.replace(/-/g, '_')}_spa_bucket`;
  const distributionOutputKey = `${service.name.replace(/-/g, '_')}_cloudfront_id`;
  let bucketName: string;
  let distributionId: string;

  try {
    bucketName = getTerraformOutput(terraformDir, bucketOutputKey, tfEnv);
  } catch {
    throw new CliError(
      `SPA infrastructure not found for service "${service.name}"`,
      'deploy-spa-aws',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first to create the bucket and CloudFront distribution`,
    );
  }

  try {
    distributionId = getTerraformOutput(
      terraformDir,
      distributionOutputKey,
      tfEnv,
    );
  } catch {
    throw new CliError(
      `CloudFront distribution not found for service "${service.name}"`,
      'deploy-spa-aws',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first to create the CloudFront distribution`,
    );
  }

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name} (${service.type})`);
  logger.info(`Bucket: ${bucketName}`);
  logger.info(`CloudFront: ${distributionId}`);
  logger.newline();

  // Fetch scoped secrets from Secrets Manager
  // SPA apps need env vars at build time since they're baked into the bundle
  logger.info('Fetching secrets from Secrets Manager...');
  const config = loadFrameworkConfig();
  const secrets = fetchServiceSecrets(service.name, config, targetEnv);
  logger.newline();

  // Build the SPA with environment variables
  logger.generating(`Building ${service.name}...`);
  const buildEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...secrets,
    NODE_ENV: 'production',
  };

  try {
    execSync(`npm run build -w ${service.name}`, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: buildEnv,
    });
  } catch {
    throw new CliError(
      `Failed to build ${service.name}`,
      'deploy-spa-aws',
      'Check build output for errors',
    );
  }
  logger.newline();

  // Determine build output directory
  // Convention: apps/{service-name}/dist or apps/{service-name}/build
  const distDir = path.join(projectRoot, 'apps', service.name, 'dist');
  const buildDir = path.join(projectRoot, 'apps', service.name, 'build');
  let sourceDir: string;

  if (fs.existsSync(distDir)) {
    sourceDir = distDir;
  } else if (fs.existsSync(buildDir)) {
    sourceDir = buildDir;
  } else {
    throw new CliError(
      `Build output not found for ${service.name}`,
      'deploy-spa-aws',
      `Expected dist/ or build/ directory in apps/${service.name}/`,
    );
  }

  // Upload to S3
  logger.generating('Uploading to S3...');
  const uploadResult = await uploadSpaToS3(runtime, {
    bucketName,
    sourceDir,
    credentials,
  });

  logger.success(`  ✓ ${uploadResult.filesUploaded} files uploaded`);
  if (uploadResult.filesDeleted > 0) {
    logger.info(`  ✓ ${uploadResult.filesDeleted} stale files deleted`);
  }
  logger.newline();

  // Invalidate CloudFront cache
  logger.generating('Invalidating CloudFront cache...');
  try {
    const invalidationResult = await invalidateCloudfront(runtime, {
      distributionId,
      credentials,
    });
    logger.success(
      `  ✓ Invalidation created: ${invalidationResult.invalidationId}`,
    );
  } catch (err) {
    logger.warn(
      `  ⚠ Invalidation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
    logger.info('  Cache will expire naturally based on TTL settings');
  }

  logger.newline();
  logger.complete(`SPA ${service.name} deployed successfully!`);
  logger.newline();
}
