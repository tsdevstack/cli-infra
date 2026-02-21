/**
 * infra:deploy Command
 *
 * Deploys infrastructure to the cloud.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDeploy } from '../utils/gcp/commands';
import { awsDeploy } from '../utils/aws/commands';
import { azureDeploy } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraDeployOptions {
  env?: string;
  autoApprove?: boolean;
  infraOnly?: boolean;
  tag?: string;
  forceUnlock?: boolean;
}

/**
 * Deploy infrastructure
 */
export async function infraDeploy(options: InfraDeployOptions): Promise<void> {
  const { logger, CliError } = getContext();

  logger.newline();
  logger.info('Deploying infrastructure...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:deploy');

  if (ctx.provider === 'gcp') {
    await gcpDeploy(ctx as GCPCommandContext, {
      autoApprove: options.autoApprove,
      infraOnly: options.infraOnly,
      tag: options.tag,
    });
  } else if (ctx.provider === 'aws') {
    await awsDeploy(ctx as AWSCommandContext, {
      autoApprove: options.autoApprove,
      infraOnly: options.infraOnly,
      tag: options.tag,
      forceUnlock: options.forceUnlock,
    });
  } else if (ctx.provider === 'azure') {
    await azureDeploy(ctx as AzureCommandContext, {
      autoApprove: options.autoApprove,
      infraOnly: options.infraOnly,
      tag: options.tag,
      forceUnlock: options.forceUnlock,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:deploy',
      'Supported providers: gcp, aws, azure',
    );
  }
}
