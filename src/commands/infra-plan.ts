/**
 * infra:plan Command
 *
 * Shows planned infrastructure changes.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpPlan } from '../utils/gcp/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import { awsPlan } from '../utils/aws/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import { azurePlan } from '../utils/azure/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraPlanOptions {
  env?: string;
  forceUnlock?: boolean;
}

/**
 * Show planned infrastructure changes
 */
export async function infraPlan(options: InfraPlanOptions): Promise<void> {
  const { logger } = getContext();

  logger.newline();
  logger.info('Planning infrastructure changes...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:plan');

  if (ctx.provider === 'gcp') {
    await gcpPlan(ctx as GCPCommandContext);
  } else if (ctx.provider === 'aws') {
    await awsPlan(ctx as AWSCommandContext, {
      forceUnlock: options.forceUnlock,
    });
  } else if (ctx.provider === 'azure') {
    await azurePlan(ctx as AzureCommandContext, {
      forceUnlock: options.forceUnlock,
    });
  }
}
