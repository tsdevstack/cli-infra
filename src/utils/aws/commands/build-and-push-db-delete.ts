/**
 * Build and push db-delete Docker image
 *
 * Builds the generated db-delete directory and pushes to ECR.
 */

import { execSync } from 'node:child_process';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface BuildAndPushDbDeleteOptions {
  dbDeleteDir: string;
  ecrUrl: string;
  credentials: AWSCredentials;
}

/**
 * Build and push the db-delete Docker image to ECR
 */
export async function buildAndPushDbDelete(
  options: BuildAndPushDbDeleteOptions,
): Promise<void> {
  const { logger } = getContext();

  const { dbDeleteDir, ecrUrl, credentials } = options;
  const imageTag = `${ecrUrl}:latest`;
  const registry = ecrUrl.split('/')[0];

  logger.info('Building db-delete image...');

  // ECR login first (needed for push)
  execSync(
    `aws ecr get-login-password --region ${credentials.region} | docker login --username AWS --password-stdin ${registry}`,
    { stdio: 'inherit' },
  );

  // Docker build (npm install happens inside Dockerfile)
  // Use --platform linux/amd64 for ECS Fargate compatibility
  execSync(`docker build --platform linux/amd64 -t ${imageTag} .`, {
    cwd: dbDeleteDir,
    stdio: 'inherit',
  });

  // Docker push
  logger.info('Pushing db-delete image to ECR...');
  execSync(`docker push ${imageTag}`, { stdio: 'inherit' });

  logger.success('db-delete image pushed to ECR');
}
