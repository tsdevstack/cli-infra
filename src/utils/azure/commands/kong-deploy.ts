/**
 * Azure Kong Deployment
 *
 * Deploys Kong Gateway to Azure App Service with secrets from Key Vault.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { deployAppService } from './deploy-app-service';
import { setAppServiceSettings } from './set-app-service-settings';
import { fetchSecret } from '../../credentials/fetch-secret';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

interface AzureKongDeployParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: AzureCredentials;
  imageTag: string;
}

const KONG_SECRETS = [
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_TLS',
  'AUTH_SERVICE_URL',
  'KONG_SSL_VERIFY',
  'KONG_TRUST_TOKEN',
  'KONG_CORS_ORIGINS',
];

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

  // Fetch Kong secrets and set as App Service settings
  logger.info('Setting Kong secrets as App Service settings...');
  const settings: Record<string, string> = {};

  for (const secretName of KONG_SECRETS) {
    const value = fetchSecret(secretName, targetEnv);
    if (value) {
      settings[secretName] = value;
      logger.success(`  ✓ ${secretName}`);
    }
  }

  if (Object.keys(settings).length > 0) {
    await setAppServiceSettings(
      credentials,
      resourceGroupName,
      kongAppServiceName,
      settings,
    );
  }

  // Deploy Kong to App Service
  logger.newline();
  logger.info('Deploying Kong to App Service...');

  await deployAppService({
    credentials,
    resourceGroupName,
    appServiceName: kongAppServiceName,
    acrLoginServer,
    imageUri,
  });

  logger.newline();
  logger.complete('Kong Gateway deployed successfully!');
  logger.newline();
}
