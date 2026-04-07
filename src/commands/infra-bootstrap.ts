/**
 * infra:bootstrap Command
 *
 * Bootstraps cloud provider for infrastructure management.
 * - GCP: Enables required APIs and adds IAM roles to Deploy SA
 * - AWS: Verifies credentials and attempts to grant missing permissions
 *
 * Run once per project. Called by cloud:init or can be run directly.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { enableRequiredApis } from '../utils/gcp/bootstrap/enable-required-apis';
import { upgradeSelfPermissions } from '../utils/gcp/bootstrap/upgrade-self-permissions';
import { waitForApiPropagation } from '../utils/gcp/bootstrap/wait-for-api-propagation';
import { awsBootstrap } from '../utils/aws/commands';
import { azureBootstrap } from '../utils/azure/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';

interface InfraBootstrapOptions {
  env?: string;
}

/**
 * Bootstrap cloud provider - configure permissions and APIs
 */
export async function infraBootstrap(
  options: InfraBootstrapOptions,
): Promise<void> {
  const { logger } = getContext();

  const ctx = await setupInfraCommand(options, 'infra:bootstrap');

  if (ctx.provider === 'gcp') {
    logger.newline();
    logger.info('Bootstrapping GCP project...');
    logger.newline();

    // Step 1: Enable APIs
    logger.info('Step 1/2: Enabling required APIs...');
    await enableRequiredApis(ctx as GCPCommandContext);
    logger.newline();

    // Wait for GCP to finish creating service agents from API enablement
    logger.info('Waiting for API service agents to settle...');
    await waitForApiPropagation();

    // Step 2: Add roles to SA
    logger.info('Step 2/2: Adding infrastructure permissions...');
    await upgradeSelfPermissions(ctx as GCPCommandContext);

    logger.newline();
    logger.complete('Bootstrap complete!');
    logger.info('SA now has all required permissions.');
    logger.newline();
  } else if (ctx.provider === 'aws') {
    logger.newline();
    logger.info('Bootstrapping AWS account...');
    logger.newline();

    await awsBootstrap(ctx as AWSCommandContext);
  } else if (ctx.provider === 'azure') {
    logger.newline();
    logger.info('Bootstrapping Azure subscription...');
    logger.newline();

    await azureBootstrap(ctx as AzureCommandContext);
  } else {
    const { CliError } = getContext();
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:bootstrap',
      'Supported providers: gcp, aws, azure',
    );
  }
}
