/**
 * Build and push the db-init image to Azure Container Registry
 */

import { execSync } from 'node:child_process';
import { configureAcrAuth } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { buildRuntime } from '../build-runtime';

export interface BuildAndPushAzureDbInitOptions {
  /** Generated db-init folder (Dockerfile, package.json, index.js) */
  dbInitDir: string;
  /** The registry's login server ({name}.azurecr.io) */
  acrLoginServer: string;
  credentials: AzureCredentials;
}

/**
 * Builds the image for Container Apps (linux/amd64) and pushes it as
 * {registry}/db-init:latest
 *
 * @returns The image it pushed
 */
export async function buildAndPushAzureDbInit(
  options: BuildAndPushAzureDbInitOptions,
): Promise<string> {
  const { logger } = getContext();
  const image = `${options.acrLoginServer}/db-init:latest`;

  logger.info('Building db-init image...');
  await configureAcrAuth(
    buildRuntime(),
    options.credentials,
    options.acrLoginServer,
  );
  execSync(`docker build --platform linux/amd64 -t ${image} .`, {
    cwd: options.dbInitDir,
    stdio: 'inherit',
  });

  logger.info('Pushing db-init image to the registry...');
  execSync(`docker push ${image}`, { stdio: 'inherit' });

  logger.success('db-init image pushed');
  return image;
}
