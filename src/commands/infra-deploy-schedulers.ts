/**
 * infra:deploy-schedulers Command
 *
 * Deploys all scheduled jobs (Cloud Scheduler on GCP, EventBridge on AWS).
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDeploySchedulers } from '../utils/gcp/commands';
import { awsDeploySchedulers } from '../utils/aws/commands';
import { azureDeploySchedulers } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraDeploySchedulersOptions {
  env?: string;
  autoApprove?: boolean;
}

/**
 * Deploy all scheduled jobs to Cloud Scheduler
 */
export async function infraDeploySchedulers(
  options: InfraDeploySchedulersOptions,
): Promise<void> {
  const { logger } = getContext();

  logger.newline();
  logger.info('Deploying all scheduled jobs...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:deploy-schedulers');

  const { CliError } = getContext();

  if (ctx.provider === 'gcp') {
    await gcpDeploySchedulers(ctx as GCPCommandContext, {
      autoApprove: options.autoApprove,
    });
  } else if (ctx.provider === 'aws') {
    await awsDeploySchedulers(ctx as AWSCommandContext, {
      autoApprove: options.autoApprove,
    });
  } else if (ctx.provider === 'azure') {
    await azureDeploySchedulers(ctx as AzureCommandContext, {
      autoApprove: options.autoApprove,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:deploy-schedulers',
      'Supported providers: gcp, aws, azure',
    );
  }
}
