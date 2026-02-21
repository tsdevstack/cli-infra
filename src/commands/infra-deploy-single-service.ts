/**
 * infra:deploy-service Command
 *
 * Deploy a SINGLE service (full workflow: build, push, migrate, deploy).
 * Interactive selection in CLI mode, requires service name in CI.
 *
 * Usage:
 *   npx tsdevstack infra:deploy-service <service-name> --env <env>
 *   npx tsdevstack infra:deploy-service --env <env>  # Interactive selection (CLI only)
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDeployServices } from '../utils/gcp/commands';
import { awsDeployServices } from '../utils/aws/commands/deploy-services';
import { azureDeployServices } from '../utils/azure/commands';
import { selectDeployableService } from '../utils/interactive';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraDeploySingleServiceOptions {
  env?: string;
  skipGenerate?: boolean;
  tag?: string;
}

/**
 * Deploy a single service (full workflow)
 */
export async function infraDeploySingleService(
  serviceName: string | undefined,
  options: InfraDeploySingleServiceOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();

  logger.newline();
  logger.info('Deploying single service...');
  logger.newline();

  const runningInCI = isCIEnv();

  // In CI mode, service name is required
  if (!serviceName && runningInCI) {
    throw new CliError(
      'Service name required in CI mode',
      'infra:deploy-service',
      'Usage: npx tsdevstack infra:deploy-service <service-name> --env <env>',
    );
  }

  // If no service name provided in CLI mode, do interactive selection
  if (!serviceName) {
    serviceName = await selectDeployableService();
  }

  const ctx = await setupInfraCommand(options, 'infra:deploy-service');

  if (ctx.provider === 'gcp') {
    await gcpDeployServices(ctx as GCPCommandContext, {
      service: serviceName,
      skipGenerate: options.skipGenerate,
      tag: options.tag,
    });
  } else if (ctx.provider === 'aws') {
    await awsDeployServices(ctx as AWSCommandContext, {
      service: serviceName,
      skipGenerate: options.skipGenerate,
      tag: options.tag,
    });
  } else if (ctx.provider === 'azure') {
    await azureDeployServices(ctx as AzureCommandContext, {
      service: serviceName,
      skipGenerate: options.skipGenerate,
      tag: options.tag,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:deploy-service',
      'Supported providers: gcp, aws, azure',
    );
  }
}
