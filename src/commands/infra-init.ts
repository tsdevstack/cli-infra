/**
 * infra:init Command
 *
 * Initializes infrastructure by creating the state bucket.
 * This is the first command to run - handles cloud provider setup if needed.
 */

import * as path from 'path';
import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpInit } from '../utils/gcp/commands';
import { awsInit } from '../utils/aws/commands';
import { azureBootstrap } from '../utils/azure/commands';
import type { GCPCommandContext } from '../utils/gcp/commands';
import type { AWSCommandContext } from '../utils/aws/commands';
import type { AzureCommandContext } from '../utils/azure/commands';
import { generateInfrastructureSchema } from '../utils/infrastructure/generate-infrastructure-schema';
import type { SchemaProvider } from '../utils/infrastructure/get-provider-schema-config';
import { INFRASTRUCTURE_SCHEMA_FILENAME } from '../constants';

interface InfraInitOptions {
  env?: string;
}

/**
 * Initialize infrastructure (create state bucket)
 */
export async function infraInit(options: InfraInitOptions): Promise<void> {
  const {
    logger,
    loadFrameworkConfig,
    findProjectRoot,
    executeCommand,
    writeTextFile,
    CliError,
    isCIEnv,
    TSDEVSTACK_DIR,
  } = getContext();

  const runningInCI = isCIEnv();

  logger.newline();
  logger.info('Initializing infrastructure...');
  if (runningInCI) {
    logger.info('(running in CI mode)');
  }
  logger.newline();

  // Handle missing cloud provider (interactive setup)
  const projectRoot = findProjectRoot();
  let config = loadFrameworkConfig();
  let provider = config.cloud.provider;

  if (!provider) {
    if (runningInCI) {
      throw new CliError(
        'No cloud provider configured',
        'infra:init',
        'Set cloud.provider in .tsdevstack/config.json',
      );
    }

    logger.warn('No cloud provider configured.');
    logger.newline();
    logger.info('Running cloud:init to configure a provider...');
    logger.newline();

    executeCommand('npx tsdevstack cloud:init', {
      cwd: projectRoot,
      logCommand: false,
    });

    config = loadFrameworkConfig();
    provider = config.cloud.provider;

    if (!provider) {
      throw new CliError(
        'Cloud provider still not configured after cloud:init',
        'infra:init',
        'Please run cloud:init manually and select a provider',
      );
    }

    logger.newline();
  }

  // Generate infrastructure schema (for IDE autocomplete)
  // Always regenerate in case provider changed
  const schemaPath = path.join(
    projectRoot,
    TSDEVSTACK_DIR,
    INFRASTRUCTURE_SCHEMA_FILENAME,
  );
  const schemaContent = generateInfrastructureSchema(
    provider as SchemaProvider,
  );
  writeTextFile(schemaPath, schemaContent);
  logger.info(
    `Generated ${TSDEVSTACK_DIR}/${INFRASTRUCTURE_SCHEMA_FILENAME} for ${provider}`,
  );

  const ctx = await setupInfraCommand(options, 'infra:init');

  if (ctx.provider === 'gcp') {
    await gcpInit(ctx as GCPCommandContext);
  } else if (ctx.provider === 'aws') {
    await awsInit(ctx as AWSCommandContext);
  } else if (ctx.provider === 'azure') {
    await azureBootstrap(ctx as AzureCommandContext);
  }
}
