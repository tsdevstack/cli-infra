/**
 * Push Kong Image to Azure ACR
 *
 * Configures ACR authentication and pushes the Kong Docker image.
 */

import { execSync } from 'node:child_process';
import { getContext } from '../../../context';
import { configureAcrAuth } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

export async function pushAzureKongImage(
  fullImageTag: string,
  loginServer: string,
  credentials: AzureCredentials,
): Promise<void> {
  const { logger } = getContext();
  const runtime = buildRuntime();

  logger.generating(`Configuring Docker authentication for ${loginServer}...`);
  await configureAcrAuth(runtime, credentials, loginServer);

  logger.generating('Pushing to registry...');
  execSync(`docker push ${fullImageTag}`, {
    stdio: 'inherit',
  });

  logger.success(`  ✓ Image pushed: ${fullImageTag}`);
}
