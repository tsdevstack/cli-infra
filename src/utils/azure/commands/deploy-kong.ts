/**
 * Azure Kong Deployment
 *
 * Deploys Kong Gateway to Azure App Service. Config values are baked into
 * kong.yml at Docker image build time, except Kong's runtime secrets
 * (KONG_RUNTIME_SECRETS): App Service settings reference them in the shared
 * Key Vault, Kong's identity can read exactly those secrets, and kong.yml
 * references the settings ({vault://env/...}).
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
import { grantKeyVaultSecretRead } from '../key-vault/grant-key-vault-secret-read';
import { buildKongVaultSecretNames } from '../key-vault/build-kong-vault-secret-names';
import { buildKeyVaultReference } from '../key-vault/build-key-vault-reference';
import { waitForKeyVaultReferences } from '../key-vault/wait-for-key-vault-references';
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
  const { logger, CliError, buildKeyVaultName } = getContext();
  const runtime = buildRuntime();
  const { projectRoot, targetEnv, projectName, credentials, imageTag } = params;

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
  let kongPrincipalId: string;

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
    kongPrincipalId = getTerraformOutput(
      terraformDir,
      'kong_principal_id',
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

  // Kong's runtime secrets, by their names in the shared vault (hyphens)
  const keyVaultName = buildKeyVaultName(projectName, targetEnv);
  const vaultSecretNames = buildKongVaultSecretNames(projectName);

  logger.info('Granting Kong read access to its secrets...');
  await grantKeyVaultSecretRead({
    credentials,
    resourceGroupName,
    keyVaultName,
    secretNames: vaultSecretNames.map(({ secretName }) => secretName),
    principalId: kongPrincipalId,
  });

  // Deploy Kong to App Service
  logger.info('Deploying Kong to App Service...');

  await deployAppService({
    credentials,
    resourceGroupName,
    appServiceName: kongAppServiceName,
    acrLoginServer,
    imageUri,
    appSettings: {
      // Kong's per-IP limits need the client address from Front Door
      ...AZURE_KONG_CLIENT_IP_SETTINGS,
      // Kong's runtime secrets, read from Key Vault by App Service
      ...Object.fromEntries(
        vaultSecretNames.map(({ key, secretName }) => [
          key,
          buildKeyVaultReference(keyVaultName, secretName),
        ]),
      ),
    },
  });

  logger.info('Waiting for Kong to receive its secrets...');
  await waitForKeyVaultReferences({
    credentials,
    resourceGroupName,
    appServiceName: kongAppServiceName,
    settingNames: vaultSecretNames.map(({ key }) => key),
  });

  logger.newline();
  logger.complete('Kong Gateway deployed successfully!');
  logger.newline();
}
