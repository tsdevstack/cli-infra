/**
 * infra:remove-service Command
 *
 * Removes a service's cloud resources from a specific environment.
 * Does NOT modify local config.json - use remove-service for that.
 *
 * Discovery-based: Queries cloud to find what resources exist.
 * Does NOT require service to be in config.json - works in any order.
 *
 * Flow:
 * 1. Load context (credentials, project name from config.json)
 * 2. Accept service name as text input (no config validation)
 * 3. Discover resources by querying cloud
 * 4. Show warning and get confirmation
 * 5. Delete resources in order (Cloud Run first, then others)
 * 6. Sync Terraform state
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpRemoveService } from '../utils/gcp/commands';
import { awsRemoveService } from '../utils/aws/commands/remove-service';
import { azureRemoveService } from '../utils/azure/commands/remove-service';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands/types';
import type { AzureCommandContext } from '../utils/azure/commands/types';

interface InfraRemoveServiceOptions {
  env?: string;
  confirm?: boolean;
  dryRun?: boolean;
}

/**
 * Remove a service from cloud
 */
export async function infraRemoveService(
  serviceName: string | undefined,
  options: InfraRemoveServiceOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();

  logger.newline();
  logger.warn('Remove Service from Cloud');
  logger.newline();

  const runningInCI = isCIEnv();

  // Require --confirm in CI mode
  if (runningInCI && !options.confirm) {
    throw new CliError(
      '--confirm flag required in CI mode',
      'infra:remove-service',
      'Add --confirm to skip interactive prompts',
    );
  }

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:remove-service');
  const { provider } = ctx;

  if (provider === 'gcp') {
    await gcpRemoveService({
      serviceName,
      ctx: ctx as GCPCommandContext,
      runningInCI,
      dryRunOption: options.dryRun,
      confirmOption: options.confirm,
    });
  } else if (provider === 'aws') {
    await awsRemoveService({
      serviceName,
      ctx: ctx as AWSCommandContext,
      runningInCI,
      dryRunOption: options.dryRun,
      confirmOption: options.confirm,
    });
  } else if (provider === 'azure') {
    await azureRemoveService({
      serviceName,
      ctx: ctx as AzureCommandContext,
      runningInCI,
      dryRunOption: options.dryRun,
      confirmOption: options.confirm,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:remove-service',
      'Supported providers: gcp, aws, azure',
    );
  }
}
