/**
 * GCP Kong Deployment
 *
 * Deploys Kong Gateway to Cloud Run.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import { buildGcpTerraformEnv, waitForImage } from '@tsdevstack/infra-core';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import { deployKongCloudRun } from '../deploy-kong-cloud-run';
import { setSecretViaCli } from '../../credentials/set-secret-via-cli';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getKongConfig } from '../../infrastructure/merge-with-defaults';
import type { GCPCredentials } from 'tsdevstack/plugin';

interface GcpKongDeployParams {
  projectRoot: string;
  targetEnv: string;
  projectName: string;
  credentials: GCPCredentials;
  imageTag: string;
}

/**
 * Deploy Kong Gateway to Cloud Run
 */
export async function gcpKongDeploy(
  params: GcpKongDeployParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const runtime = buildRuntime();
  const { projectRoot, targetEnv, projectName, credentials, imageTag } = params;

  const tfEnv = buildGcpTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  // Get required terraform outputs
  let registryUrl: string;
  let vpcNetwork: string;
  let vpcSubnet: string;
  let kongServiceAccount: string;

  try {
    registryUrl = getTerraformOutput(
      terraformDir,
      'artifact_registry_url',
      tfEnv,
    );
    // Fetch VPC network and subnet for Direct VPC Egress
    vpcNetwork = getTerraformOutput(terraformDir, 'vpc_id', tfEnv);
    vpcSubnet = getTerraformOutput(terraformDir, 'subnet_id', tfEnv);

    // Try to get Kong-specific service account, fall back to runtime SA map
    try {
      kongServiceAccount = getTerraformOutput(
        terraformDir,
        'kong_service_account_email',
        tfEnv,
      );
    } catch {
      // Fall back to getting from runtime SA map if Kong-specific doesn't exist
      const serviceAccountEmails = getTerraformOutputJson<
        Record<string, string>
      >(terraformDir, 'runtime_service_account_emails', tfEnv);
      // Use a default runtime SA or the first one available
      kongServiceAccount =
        serviceAccountEmails['kong'] || Object.values(serviceAccountEmails)[0];
      if (!kongServiceAccount) {
        throw new CliError(
          'No service account found for Kong',
          'infra:deploy-kong',
          'Ensure Terraform outputs include Kong service account',
        );
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('No service account')
    ) {
      throw error;
    }
    throw new CliError(
      'Failed to get required Terraform outputs',
      'infra:deploy-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  const imageUri = `${registryUrl}/kong:${imageTag}`;

  // Load infrastructure config for Kong settings
  const infraConfig = loadInfrastructureConfig();
  const kongConfig = getKongConfig(infraConfig, targetEnv, 'gcp');

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Image: ${imageUri}`);
  logger.info(`Service Account: ${kongServiceAccount}`);
  logger.info(`VPC Network: ${vpcNetwork}`);
  logger.info(`VPC Subnet: ${vpcSubnet}`);
  logger.info(`Min instances: ${kongConfig.minInstances}`);
  logger.info(`Max instances: ${kongConfig.maxInstances}`);
  logger.info(`CPU: ${kongConfig.cpu}, Memory: ${kongConfig.memory}`);
  logger.newline();

  // Verify image exists before deploying
  await waitForImage(runtime, {
    imageUri,
    credentials,
  });
  logger.newline();

  // Deploy Kong to Cloud Run
  const result = await deployKongCloudRun({
    projectId: credentials.project_id,
    projectName,
    region: credentials.region,
    imageUri,
    vpcNetwork,
    vpcSubnet,
    serviceAccount: kongServiceAccount,
    credentials,
    minInstances: kongConfig.minInstances,
    maxInstances: kongConfig.maxInstances,
    cpu: kongConfig.cpu,
    memory: kongConfig.memory,
  });

  logger.newline();
  if (result.success) {
    logger.complete('Kong Gateway deployed successfully!');
    if (result.serviceUrl) {
      logger.info(`Service URL: ${result.serviceUrl}`);

      // Auto-save Kong internal URL as shared secret for server-side calls
      // This allows Next.js apps to call Kong directly via VPC, bypassing LB/Cloud Armor
      logger.newline();
      logger.info('Saving KONG_INTERNAL_URL to Secret Manager...');
      try {
        setSecretViaCli('KONG_INTERNAL_URL', result.serviceUrl, targetEnv);
        logger.success('KONG_INTERNAL_URL saved as shared secret');
      } catch {
        logger.warn('Failed to save KONG_INTERNAL_URL secret (non-fatal)');
        logger.warn(
          'You can set it manually: npx tsdevstack cloud-secrets:set KONG_INTERNAL_URL "<url>" --env ' +
            targetEnv,
        );
      }
    }
  }
  logger.newline();

  logger.info('Next steps:');
  logger.info(
    `  Deploy load balancer: npx tsdevstack infra:deploy-lb --env ${targetEnv}`,
  );
  logger.newline();
}
