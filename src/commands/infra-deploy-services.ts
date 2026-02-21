/**
 * infra:deploy-services Command
 *
 * Orchestrates the complete service deployment workflow:
 * - Backend/Frontend (nestjs, nextjs): Docker build → push → Cloud Run/ECS
 * - Workers: Deployed alongside their base service (same Docker image)
 * - SPA: Build → upload to Cloud Storage/S3
 *
 * This is a convenience command for local development.
 * CI/CD uses granular commands for selective deployment.
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpDeployServices } from '../utils/gcp/commands';
import { awsDeployServices } from '../utils/aws/commands/deploy-services';
import { azureDeployServices } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';

interface InfraDeployServicesOptions {
  env?: string;
  service?: string;
  skipGenerate?: boolean;
  tag?: string;
  maxParallel?: number;
}

/**
 * Deploy services (orchestrates full workflow)
 */
export async function infraDeployServices(
  options: InfraDeployServicesOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  logger.newline();
  logger.info('Deploying services...');
  logger.newline();

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:deploy-services');

  if (ctx.provider === 'gcp') {
    await gcpDeployServices(ctx as GCPCommandContext, {
      service: options.service,
      skipGenerate: options.skipGenerate,
      tag: options.tag,
      maxParallel: options.maxParallel,
    });
  } else if (ctx.provider === 'aws') {
    await awsDeployServices(ctx as AWSCommandContext, {
      service: options.service,
      tag: options.tag,
      skipGenerate: options.skipGenerate,
      maxParallel: options.maxParallel,
    });
  } else if (ctx.provider === 'azure') {
    await azureDeployServices(ctx as AzureCommandContext, {
      service: options.service,
      skipGenerate: options.skipGenerate,
      tag: options.tag,
      maxParallel: options.maxParallel,
    });
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:deploy-services',
      'Supported providers: gcp, aws, azure',
    );
  }
}
