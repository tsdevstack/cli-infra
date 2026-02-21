/**
 * infra:destroy Command
 *
 * Destroys infrastructure resources.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDestroy } from '../utils/gcp/commands';
import { awsDestroy } from '../utils/aws/commands';
import { azureDestroy } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraDestroyOptions {
  env?: string;
  autoApprove?: boolean;
}

/**
 * Destroy infrastructure
 */
export async function infraDestroy(
  options: InfraDestroyOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  logger.newline();
  logger.warn('Destroying infrastructure...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:destroy');

  if (ctx.provider === 'gcp') {
    await gcpDestroy(ctx as GCPCommandContext, {
      autoApprove: options.autoApprove,
    });
  } else if (ctx.provider === 'aws') {
    await awsDestroy(ctx as AWSCommandContext, {
      autoApprove: options.autoApprove,
    });
  } else if (ctx.provider === 'azure') {
    await azureDestroy(ctx as AzureCommandContext, {
      autoApprove: options.autoApprove,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:destroy',
      'Supported providers: gcp, aws, azure',
    );
  }
}
