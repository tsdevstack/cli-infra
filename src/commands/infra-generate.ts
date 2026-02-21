/**
 * infra:generate Command
 *
 * Generates infrastructure configuration files.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpGenerate } from '../utils/gcp/commands';
import { awsGenerate } from '../utils/aws/commands';
import { azureGenerate } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraGenerateOptions {
  env?: string;
}

/**
 * Generate infrastructure configuration files
 */
export async function infraGenerate(
  options: InfraGenerateOptions,
): Promise<void> {
  const { logger } = getContext();

  logger.newline();
  logger.info('Generating infrastructure configuration...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:generate');

  if (ctx.provider === 'gcp') {
    await gcpGenerate(ctx as GCPCommandContext);
  } else if (ctx.provider === 'aws') {
    await awsGenerate(ctx as AWSCommandContext);
  } else if (ctx.provider === 'azure') {
    await azureGenerate(ctx as AzureCommandContext);
  }
}
