/**
 * GCP Kong Build utilities
 *
 * Get registry info and push Kong image to Artifact Registry.
 */

import path from 'node:path';
import { execSync } from 'node:child_process';
import { getContext } from '../../../context';
import {
  buildGcpTerraformEnv,
  configureDockerAuth,
} from '@tsdevstack/infra-core';
import { getTerraformOutput } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

interface GcpKongRegistryInfo {
  registryUrl: string;
  registryHost: string;
}

/**
 * Get Kong registry info for GCP
 */
export function getGcpKongRegistryInfo(
  projectRoot: string,
  targetEnv: string,
  credentials: GCPCredentials,
): GcpKongRegistryInfo {
  const { CliError } = getContext();

  const runtime = buildRuntime();
  const tfEnv = buildGcpTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let registryUrl: string;
  try {
    registryUrl = getTerraformOutput(
      terraformDir,
      'artifact_registry_url',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Failed to get artifact_registry_url from Terraform outputs',
      'infra:build-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  const registryHost = `${credentials.region}-docker.pkg.dev`;

  return { registryUrl, registryHost };
}

/**
 * Push Kong image to GCP Artifact Registry
 */
export async function pushGcpKongImage(
  fullImageTag: string,
  registryHost: string,
  credentials: GCPCredentials,
): Promise<void> {
  const { logger } = getContext();

  logger.generating(`Configuring Docker authentication for ${registryHost}...`);
  await configureDockerAuth(credentials, registryHost);

  logger.generating('Pushing to registry...');
  execSync(`docker push ${fullImageTag}`, {
    stdio: 'inherit',
  });

  logger.success(`  ✓ Image pushed: ${fullImageTag}`);
}
