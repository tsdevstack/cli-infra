/**
 * infra:run-cron Command
 *
 * Starts a scheduled job now, in the cloud, and waits for the run: a cron
 * job (the service's image as `node dist/cron.js <name>`) or a trigger (the
 * schedule's call to the service's endpoint). Locally, `run-cron` does the
 * same against the compose stack.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpRunCron } from '../utils/gcp/commands';
import { azureRunCron } from '../utils/azure/commands';
import { awsRunCron } from '../utils/aws/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AzureCommandContext } from '../utils/azure/commands';
import type { AWSCommandContext } from '../utils/aws/commands';

interface InfraRunCronOptions {
  env?: string;
  job: string;
  /**
   * --no-lines (hidden, the MCP tool) sets it to false: a failed run's log
   * lines are left out. Azure prints none in either case (they arrive later)
   */
  lines?: boolean;
}

/**
 * Start a scheduled job now and wait for its run
 */
export async function infraRunCron(
  options: InfraRunCronOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  logger.newline();
  logger.info('Running a scheduled job now...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:run-cron');

  const lines = options.lines ?? true;

  if (ctx.provider === 'gcp') {
    await gcpRunCron(ctx as GCPCommandContext, { job: options.job, lines });
  } else if (ctx.provider === 'azure') {
    await azureRunCron(ctx as AzureCommandContext, { job: options.job });
  } else if (ctx.provider === 'aws') {
    await awsRunCron(ctx as AWSCommandContext, { job: options.job, lines });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:run-cron',
      'Supported providers: gcp, aws, azure',
    );
  }
}
