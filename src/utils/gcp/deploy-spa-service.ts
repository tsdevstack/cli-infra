/**
 * Deploy SPA service to Cloud Storage
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getContext } from '../../context';
import {
  buildGcpTerraformEnv,
  uploadSpaToCloudStorage,
} from '@tsdevstack/infra-core';
import { getTerraformOutput } from './terraform';
import { buildRuntime } from '../build-runtime';
import { fetchServiceSecrets } from '../deploy/fetch-service-secrets';
import type { GCPCredentials } from 'tsdevstack/plugin';

export interface DeploySpaServiceOptions {
  projectRoot: string;
  targetEnv: string;
  credentials: GCPCredentials;
  service: { name: string; type: string };
}

/**
 * Deploy an SPA service to Cloud Storage
 */
export async function deploySpaService(
  options: DeploySpaServiceOptions,
): Promise<void> {
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const runtime = buildRuntime();
  const { projectRoot, targetEnv, credentials, service } = options;

  logger.info('Deploying SPA to Cloud Storage...');
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
      'infra:service-deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Build Terraform environment
  const tfEnv = buildGcpTerraformEnv(runtime, credentials);

  // Get bucket name from terraform output
  // Terraform output key format: {service_name}_spa_bucket (underscores)
  const outputKey = `${service.name.replace(/-/g, '_')}_spa_bucket`;
  let bucketName: string;

  try {
    bucketName = getTerraformOutput(terraformDir, outputKey, tfEnv);
  } catch {
    throw new CliError(
      `SPA infrastructure not found for service "${service.name}"`,
      'infra:service-deploy',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first to create the bucket, CDN, and load balancer routing`,
    );
  }

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Service: ${service.name} (${service.type})`);
  logger.info(`Bucket: ${bucketName}`);
  logger.newline();

  // Fetch scoped secrets from Secret Manager
  // SPA apps need env vars at build time since they're baked into the bundle
  logger.info('Fetching secrets from Secret Manager...');
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
      'infra:service-deploy',
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
      'infra:service-deploy',
      `Expected dist/ or build/ directory in apps/${service.name}/`,
    );
  }

  // Upload to Cloud Storage
  logger.generating('Uploading to Cloud Storage...');
  const result = await uploadSpaToCloudStorage(runtime, {
    bucketName,
    sourceDir,
    credentials,
  });

  logger.newline();
  logger.complete(`SPA ${service.name} deployed successfully!`);
  logger.info(`Files uploaded: ${result.filesUploaded}`);
  if (result.filesDeleted > 0) {
    logger.info(`Stale files deleted: ${result.filesDeleted}`);
  }
  logger.newline();
}
