/**
 * infra:list-schedulers Command
 *
 * Lists scheduled jobs and their deployment status.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpListSchedulers } from '../utils/gcp/commands';
import { awsListSchedulers } from '../utils/aws/commands';
import { azureListSchedulers } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraListSchedulersOptions {
  env?: string;
}

/**
 * List scheduled jobs and their deployment status
 */
export async function infraListSchedulers(
  options: InfraListSchedulersOptions,
): Promise<void> {
  const { logger } = getContext();

  logger.newline();
  logger.info('Listing scheduled jobs...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:list-schedulers');

  const { CliError } = getContext();

  if (ctx.provider === 'gcp') {
    await gcpListSchedulers(ctx as GCPCommandContext);
  } else if (ctx.provider === 'aws') {
    await awsListSchedulers(ctx as AWSCommandContext);
  } else if (ctx.provider === 'azure') {
    await azureListSchedulers(ctx as AzureCommandContext);
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:list-schedulers',
      'Supported providers: gcp, aws, azure',
    );
  }
}
