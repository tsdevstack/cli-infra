/**
 * infra:deploy-kong Command
 *
 * Deploys Kong Gateway to Cloud Run (GCP) or ECS (AWS).
 */

import path from 'node:path';
import fs from 'node:fs';
import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { getGitSha } from '../utils/docker';
import { gcpKongDeploy } from '../utils/gcp/commands';
import { awsKongDeploy } from '../utils/aws/commands';
import { azureKongDeploy } from '../utils/azure/commands';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from '@tsdevstack/cli/plugin';

interface InfraKongDeployOptions {
  env?: string;
  tag?: string;
}

/**
 * Deploy Kong Gateway to Cloud Run (GCP) or ECS (AWS)
 */
export async function infraKongDeploy(
  options: InfraKongDeployOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  logger.newline();
  logger.info('Deploying Kong Gateway...');
  logger.newline();

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:deploy-kong');
  const { projectRoot, targetEnv, provider, projectName } = ctx;

  // Validate terraform directory exists
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'infra:deploy-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Get image tag
  const imageTag = options.tag ?? getGitSha();

  if (provider === 'gcp') {
    await gcpKongDeploy({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as GCPCredentials,
      imageTag,
    });
  } else if (provider === 'aws') {
    await awsKongDeploy({
      projectRoot,
      targetEnv,
      credentials: ctx.credentials as AWSCredentials,
      imageTag,
    });
  } else if (provider === 'azure') {
    await azureKongDeploy({
      projectRoot,
      targetEnv,
      projectName,
      credentials: ctx.credentials as AzureCredentials,
      imageTag,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:deploy-kong',
      'Supported providers: gcp, aws, azure',
    );
  }
}
