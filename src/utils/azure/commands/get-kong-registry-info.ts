/**
 * Get Kong Registry Info for Azure
 *
 * Retrieves ACR registry URL from Terraform outputs.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { getTerraformOutput } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AzureCredentials } from 'tsdevstack/plugin';

export interface AzureKongRegistryInfo {
  registryUrl: string;
  registryHost: string;
}

export function getAzureKongRegistryInfo(
  projectRoot: string,
  targetEnv: string,
  credentials: AzureCredentials,
): AzureKongRegistryInfo {
  const { CliError } = getContext();
  const runtime = buildRuntime();

  const tfEnv = buildAzureTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let registryUrl: string;
  try {
    registryUrl = getTerraformOutput(terraformDir, 'acr_login_server', tfEnv);
  } catch {
    throw new CliError(
      'Failed to get acr_login_server from Terraform outputs',
      'infra:build-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  return { registryUrl, registryHost: registryUrl };
}
