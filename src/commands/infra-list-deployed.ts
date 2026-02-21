/**
 * infra:list-deployed Command
 *
 * Discover and list ALL deployed services in an environment.
 * Discovery-based: queries cloud to find what's deployed.
 *
 * Usage:
 *   npx tsdevstack infra:list-deployed --env <env>
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpListDeployed } from '../utils/gcp/commands';
import { awsListDeployed } from '../utils/aws/commands';
import { azureListDeployed } from '../utils/azure/commands';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from '@tsdevstack/cli/plugin';

interface InfraListDeployedOptions {
  env?: string;
}

/**
 * List all deployed services in an environment
 */
export async function infraListDeployed(
  options: InfraListDeployedOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  logger.newline();
  logger.info('Deployed Services');
  logger.newline();

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:list-deployed');
  const { projectName, targetEnv, provider } = ctx;

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Project: ${projectName}`);
  logger.newline();

  if (provider === 'gcp') {
    const credentials = ctx.credentials as GCPCredentials;

    await gcpListDeployed({
      projectName,
      targetEnv,
      credentials,
    });
  } else if (provider === 'aws') {
    const credentials = ctx.credentials as AWSCredentials;

    await awsListDeployed({
      projectName,
      targetEnv,
      credentials,
    });
  } else if (provider === 'azure') {
    const credentials = ctx.credentials as AzureCredentials;

    await azureListDeployed({
      projectName,
      targetEnv,
      credentials,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:list-deployed',
      'Supported providers: gcp, aws, azure',
    );
  }
}
