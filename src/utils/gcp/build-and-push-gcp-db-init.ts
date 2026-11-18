/**
 * Build and push the db-init image to Artifact Registry (GCP)
 */

import { execSync } from 'node:child_process';
import { configureDockerAuth } from '@tsdevstack/infra-core';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';

export interface BuildAndPushGcpDbInitOptions {
  /** Generated db-init folder (Dockerfile, package.json, index.js) */
  dbInitDir: string;
  /** {registry}/db-init:latest */
  imageUri: string;
  credentials: GCPCredentials;
}

/**
 * Builds the image for Cloud Run (linux/amd64) and pushes it, the way the
 * AWS deploy pushes its db-init to ECR
 */
export async function buildAndPushGcpDbInit(
  options: BuildAndPushGcpDbInitOptions,
): Promise<void> {
  const { logger } = getContext();

  logger.info('Building db-init image...');
  await configureDockerAuth(
    options.credentials,
    options.imageUri.split('/')[0],
  );

  execSync(`docker build --platform linux/amd64 -t ${options.imageUri} .`, {
    cwd: options.dbInitDir,
    stdio: 'inherit',
  });

  logger.info('Pushing db-init image to Artifact Registry...');
  execSync(`docker push ${options.imageUri}`, { stdio: 'inherit' });

  logger.success('db-init image pushed');
}
