/**
 * Get Kong Registry Info for AWS
 *
 * Retrieves ECR registry URL and host from Terraform outputs.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import type { AWSCredentials } from 'tsdevstack/plugin';

export interface AwsKongRegistryInfo {
  registryUrl: string;
  registryHost: string;
}

/**
 * Get Kong registry info for AWS
 */
export function getAwsKongRegistryInfo(
  projectRoot: string,
  targetEnv: string,
  credentials: AWSCredentials,
): AwsKongRegistryInfo {
  const { CliError } = getContext();

  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let registryUrl: string;
  try {
    registryUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
  } catch {
    throw new CliError(
      'Failed to get ecr_repository_url from Terraform outputs',
      'infra:build-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  const registryHost = registryUrl.split('/')[0];

  return { registryUrl, registryHost };
}
