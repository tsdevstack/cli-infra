/**
 * infra:deploy-scheduler Command
 *
 * Deploys a single scheduled job via Terraform (Cloud Scheduler on GCP, EventBridge on AWS).
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDeployScheduler } from '../utils/gcp/commands';
import { awsDeployScheduler } from '../utils/aws/commands';
import { azureDeployScheduler } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraDeploySchedulerOptions {
  env?: string;
  job?: string;
  autoApprove?: boolean;
}

/**
 * Deploy a single scheduled job to Cloud Scheduler
 */
export async function infraDeployScheduler(
  options: InfraDeploySchedulerOptions,
): Promise<void> {
  const { logger } = getContext();

  logger.newline();
  logger.info('Deploying scheduled job...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:deploy-scheduler');

  const { CliError } = getContext();

  if (ctx.provider === 'gcp') {
    await gcpDeployScheduler(ctx as GCPCommandContext, {
      job: options.job,
      autoApprove: options.autoApprove,
    });
  } else if (ctx.provider === 'aws') {
    await awsDeployScheduler(ctx as AWSCommandContext, {
      job: options.job,
      autoApprove: options.autoApprove,
    });
  } else if (ctx.provider === 'azure') {
    await azureDeployScheduler(ctx as AzureCommandContext, {
      job: options.job,
      autoApprove: options.autoApprove,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:deploy-scheduler',
      'Supported providers: gcp, aws, azure',
    );
  }
}
