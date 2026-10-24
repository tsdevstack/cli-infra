/**
 * Azure Kong Deployment
 *
 * Deploys Kong Gateway to Azure App Service. All config values are baked
 * into kong.yml at Docker image build time — no runtime secrets needed.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import {
  AZURE_KONG_CLIENT_IP_SETTINGS,
  buildAzureTerraformEnv,
} from '@tsdevstack/infra-core';
import { deployAppService } from './deploy-app-service';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

interface AzureKongDeployParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: AzureCredentials;
  imageTag: string;
}

export async function azureKongDeploy(
  params: AzureKongDeployParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const runtime = buildRuntime();
  const { projectRoot, targetEnv, credentials, imageTag } = params;

  const tfEnv = buildAzureTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let acrLoginServer: string;
  let resourceGroupName: string;
  let kongAppServiceName: string;

  try {
    acrLoginServer = getTerraformOutput(
      terraformDir,
      'acr_login_server',
      tfEnv,
    );
    resourceGroupName = getTerraformOutput(
      terraformDir,
      'resource_group_name',
      tfEnv,
    );
    kongAppServiceName = getTerraformOutput(
      terraformDir,
      'kong_app_service_name',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:deploy-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  const imageUri = `${acrLoginServer}/kong:${imageTag}`;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Image: ${imageUri}`);
  logger.info(`App Service: ${kongAppServiceName}`);
  logger.newline();

  // Deploy Kong to App Service
  logger.info('Deploying Kong to App Service...');

  await deployAppService({
    credentials,
    resourceGroupName,
    appServiceName: kongAppServiceName,
    acrLoginServer,
    imageUri,
    // Kong's per-IP limits need the client address from Front Door
    appSettings: { ...AZURE_KONG_CLIENT_IP_SETTINGS },
  });

  logger.newline();
  logger.complete('Kong Gateway deployed successfully!');
  logger.newline();
}
