/**
 * Push Kong Image to AWS ECR
 *
 * Configures ECR authentication and pushes the Kong Docker image.
 */

import { execSync } from 'node:child_process';
import { getContext } from '../../../context';
import { configureEcrAuth } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

/**
 * Push Kong image to AWS ECR
 */
export async function pushAwsKongImage(
  fullImageTag: string,
  registryUrl: string,
  credentials: AWSCredentials,
): Promise<void> {
  const { logger } = getContext();

  const registryHost = registryUrl.split('/')[0];
  logger.generating(`Configuring Docker authentication for ${registryHost}...`);
  const runtime = buildRuntime();
  await configureEcrAuth(runtime, credentials, registryUrl);

  logger.generating('Pushing to registry...');
  execSync(`docker push ${fullImageTag}`, {
    stdio: 'inherit',
  });

  logger.success(`  ✓ Image pushed: ${fullImageTag}`);
}
