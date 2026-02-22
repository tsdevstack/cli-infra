/**
 * infra:service-status Command
 *
 * Check what cloud resources exist for a specific service.
 * Discovery-based: queries cloud to find what's deployed.
 *
 * Usage:
 *   npx tsdevstack infra:service-status <service-name> --env <env>
 *   npx tsdevstack infra:service-status --env <env>  # Interactive selection
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import {
  gcpServiceStatus,
  selectServiceInteractiveGcp,
} from '../utils/gcp/commands';
import {
  awsServiceStatus,
  selectServiceInteractiveAws,
} from '../utils/aws/commands';
import {
  azureServiceStatus,
  selectServiceInteractiveAzure,
} from '../utils/azure/commands';
import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from 'tsdevstack/plugin';

interface InfraServiceStatusOptions {
  env?: string;
}

/**
 * Check cloud resource status for a service
 */
export async function infraServiceStatus(
  serviceName: string | undefined,
  options: InfraServiceStatusOptions,
): Promise<void> {
  const { logger, CliError, isCIEnv } = getContext();

  logger.newline();
  logger.info('Service Status');
  logger.newline();

  const runningInCI = isCIEnv();

  // In CI mode, service name is required
  if (!serviceName && runningInCI) {
    throw new CliError(
      'Service name required in CI mode',
      'infra:service-status',
      'Usage: npx tsdevstack infra:service-status <service-name> --env <env>',
    );
  }

  // Set up command context (this also resolves environment interactively if needed)
  const ctx = await setupInfraCommand(options, 'infra:service-status');
  const { projectName, targetEnv, provider } = ctx;

  if (provider === 'gcp') {
    const credentials = ctx.credentials as GCPCredentials;

    // If no service name provided, do interactive selection
    let resolvedServiceName = serviceName;
    if (!resolvedServiceName) {
      resolvedServiceName = await selectServiceInteractiveGcp({
        projectName,
        credentials,
      });
    }

    await gcpServiceStatus({
      serviceName: resolvedServiceName,
      projectName,
      targetEnv,
      credentials,
    });
  } else if (provider === 'aws') {
    const credentials = ctx.credentials as AWSCredentials;

    // If no service name provided, do interactive selection
    let resolvedServiceName = serviceName;
    if (!resolvedServiceName) {
      resolvedServiceName = await selectServiceInteractiveAws({
        projectName,
        credentials,
      });
    }

    await awsServiceStatus({
      serviceName: resolvedServiceName,
      projectName,
      targetEnv,
      credentials,
    });
  } else if (provider === 'azure') {
    const credentials = ctx.credentials as AzureCredentials;

    // If no service name provided, do interactive selection
    let resolvedServiceName = serviceName;
    if (!resolvedServiceName) {
      resolvedServiceName = await selectServiceInteractiveAzure({
        projectName,
        targetEnv,
        credentials,
      });
    }

    await azureServiceStatus({
      serviceName: resolvedServiceName,
      projectName,
      targetEnv,
      credentials,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:service-status',
      'Supported providers: gcp, aws, azure',
    );
  }
}
