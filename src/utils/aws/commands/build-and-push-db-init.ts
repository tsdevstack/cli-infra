/**
 * Build and push db-init Docker image
 *
 * Builds the generated db-init directory and pushes to ECR.
 */

import { execSync } from 'node:child_process';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { configureEcrAuth } from '@tsdevstack/infra-core';
import type { InfraCoreRuntime } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';

export interface BuildAndPushDbInitOptions {
  dbInitDir: string;
  ecrUrl: string;
  credentials: AWSCredentials;
  runtime: InfraCoreRuntime;
}

/**
 * Build and push the db-init Docker image to ECR
 */
export async function buildAndPushDbInit(
  options: BuildAndPushDbInitOptions,
): Promise<void> {
  const { logger } = getContext();

  const { dbInitDir, ecrUrl, credentials, runtime } = options;
  const imageTag = `${ecrUrl}:latest`;

  logger.info('Building db-init image...');

  // ECR login first (needed for push)
  await configureEcrAuth(runtime, credentials, ecrUrl);

  // Docker build (npm install happens inside Dockerfile)
  // Use --platform linux/amd64 for ECS Fargate compatibility
  execSync(`docker build --platform linux/amd64 -t ${imageTag} .`, {
    cwd: dbInitDir,
    stdio: 'inherit',
  });

  // Docker push
  logger.info('Pushing db-init image to ECR...');
  execSync(`docker push ${imageTag}`, { stdio: 'inherit' });

  logger.success('db-init image pushed to ECR');
}
