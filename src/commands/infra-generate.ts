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
import { loadInfrastructureConfig } from '../utils/infrastructure/load-infrastructure-config';
import { warnMissingApiKeyUsageJob } from '../utils/infrastructure/warn-missing-api-key-usage-job';
import { warnMissingCronHandlers } from '../utils/infrastructure/warn-missing-cron-handlers';

interface InfraGenerateOptions {
  env?: string;
}

/**
 * Generate infrastructure configuration files
 */
export async function infraGenerate(
  options: InfraGenerateOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, hasAuthTemplate, findProjectRoot } =
    getContext();

  logger.newline();
  logger.info('Generating infrastructure configuration...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:generate');

  const frameworkConfig = loadFrameworkConfig();
  const infraConfig = loadInfrastructureConfig();

  // Auth template: the API key usage sync job must be scheduled
  if (hasAuthTemplate(frameworkConfig)) {
    warnMissingApiKeyUsageJob({
      frameworkConfig,
      infraConfig,
      environment: ctx.targetEnv,
    });
  }

  // Every cron job entry needs its handler file in its service
  warnMissingCronHandlers({
    infraConfig,
    environment: ctx.targetEnv,
    projectRoot: findProjectRoot(),
  });

  if (ctx.provider === 'gcp') {
    await gcpGenerate(ctx as GCPCommandContext);
  } else if (ctx.provider === 'aws') {
    await awsGenerate(ctx as AWSCommandContext);
  } else if (ctx.provider === 'azure') {
    await azureGenerate(ctx as AzureCommandContext);
  }
}
