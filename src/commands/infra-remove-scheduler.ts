/**
 * infra:remove-scheduler Command
 *
 * Removes a scheduled job (Cloud Scheduler on GCP, EventBridge on AWS).
 * Discovery-based: queries cloud provider for deployed jobs.
 *
 * Interactive mode: prompts for environment and job selection.
 * CI mode: requires --env, --job, and --confirm flags.
 *
 * Note: This only removes the job from the cloud provider.
 * The infrastructure.json configuration should be cleaned up manually.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpRemoveScheduler } from '../utils/gcp/commands';
import { awsRemoveScheduler } from '../utils/aws/commands';
import { azureRemoveScheduler } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraRemoveSchedulerOptions {
  env?: string;
  job?: string;
  confirm?: boolean;
}

/**
 * Remove a scheduled job from the cloud provider
 */
export async function infraRemoveScheduler(
  options: InfraRemoveSchedulerOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();

  logger.newline();
  logger.warn('Remove Scheduled Job from Cloud');
  logger.newline();

  const runningInCI = isCIEnv();

  // CI mode: require all params before loading credentials
  if (runningInCI) {
    if (!options.confirm) {
      throw new CliError(
        '--confirm flag required in CI mode',
        'infra:remove-scheduler',
        'Add --confirm to skip interactive prompts',
      );
    }
    if (!options.job) {
      throw new CliError(
        '--job flag required in CI mode',
        'infra:remove-scheduler',
        'Specify job name: --job cleanup-tokens',
      );
    }
  }

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:remove-scheduler');

  if (ctx.provider === 'gcp') {
    await gcpRemoveScheduler(ctx as GCPCommandContext, {
      job: options.job,
      confirm: options.confirm,
    });
  } else if (ctx.provider === 'aws') {
    await awsRemoveScheduler(ctx as AWSCommandContext, {
      job: options.job,
      confirm: options.confirm,
    });
  } else if (ctx.provider === 'azure') {
    await azureRemoveScheduler(ctx as AzureCommandContext, {
      job: options.job,
      confirm: options.confirm,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:remove-scheduler',
      'Supported providers: gcp, aws, azure',
    );
  }
}
