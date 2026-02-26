/**
 * infra:init-ci Command
 *
 * Initializes CI/CD by creating ci.json and generating GitHub workflows.
 * Creates config, generates workflows, prints setup instructions.
 *
 * Decoupled from cloud credentials — reads provider from config.json,
 * environments from --envs flag or interactive prompt.
 *
 * Generates:
 * - pr.yml - PR checks
 * - deploy.yml - Full deployment (legacy)
 * - deploy-services.yml - Services with boolean checkboxes
 * - deploy-infra.yml - Infrastructure only
 * - deploy-kong.yml - Kong Gateway only
 * - deploy-lb.yml - Load Balancer only
 * - remove-service.yml - Service removal (cloud)
 */

import * as path from 'path';
import inquirer from 'inquirer';
import { getContext } from '../context';
import { gcpInitCi } from '../utils/gcp/commands';
import { awsInitCi } from '../utils/aws/commands';
import { azureInitCi } from '../utils/azure/commands';
import { generateInfrastructureSchema } from '../utils/infrastructure/generate-infrastructure-schema';
import { INFRASTRUCTURE_SCHEMA_FILENAME } from '../constants';
import type { SchemaProvider } from '../utils/infrastructure/get-provider-schema-config';

interface CiInitOptions {
  github?: boolean;
  envs?: string;
}

/**
 * Initialize CI/CD configuration
 */
export async function ciInit(options: CiInitOptions): Promise<void> {
  const {
    logger,
    CliError,
    loadFrameworkConfig,
    findProjectRoot,
    getConfigPath,
    writeJsonFile,
    writeTextFile,
    TSDEVSTACK_DIR,
    isCIEnv,
    getAvailableEnvironments,
    CLOUD_PROVIDERS,
  } = getContext();

  const runningInCI = isCIEnv();
  const projectRoot = findProjectRoot();

  // 1. CI provider: auto-select GitHub (only option)
  if (!options.github) {
    logger.info('Auto-selecting GitHub Actions (only supported CI provider)');
  }

  logger.newline();
  logger.info('Initializing CI/CD for GitHub Actions...');
  logger.newline();

  // 2. Cloud provider: config.json → prompt if null
  const config = loadFrameworkConfig();
  let provider = config.cloud.provider;

  if (!provider) {
    if (runningInCI) {
      throw new CliError(
        'No cloud provider configured',
        'infra:init-ci',
        'Set cloud.provider in .tsdevstack/config.json before running in CI',
      );
    }

    const { selectedProvider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedProvider',
        message: 'Select cloud provider:',
        choices: CLOUD_PROVIDERS.map((p: string) => ({ name: p, value: p })),
      },
    ]);
    provider = selectedProvider as 'gcp' | 'aws' | 'azure';

    // Write provider back to config.json
    config.cloud.provider = provider;
    const configPath = getConfigPath(projectRoot);
    writeJsonFile(configPath, config);
    logger.info(`Set cloud.provider = "${provider}" in config.json`);
    logger.newline();
  }

  // 3. Environments: --envs flag → interactive prompt → error
  let environments: string[] = [];

  if (options.envs) {
    environments = options.envs
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  } else if (!runningInCI) {
    // Try credentials fallback for suggestions
    let credentialEnvs: string[] = [];
    try {
      credentialEnvs = getAvailableEnvironments(projectRoot, provider!);
    } catch {
      // No credentials — that's fine
    }

    if (credentialEnvs.length > 0) {
      const { envInput } = await inquirer.prompt([
        {
          type: 'input',
          name: 'envInput',
          message: 'Environments (comma-separated):',
          default: credentialEnvs.join(', '),
        },
      ]);
      environments = (envInput as string)
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
    } else {
      const { envInput } = await inquirer.prompt([
        {
          type: 'input',
          name: 'envInput',
          message: 'Environments (comma-separated, e.g. dev, staging, prod):',
        },
      ]);
      environments = (envInput as string)
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
    }
  } else {
    throw new CliError(
      'No environments specified',
      'infra:init-ci',
      'Use --envs flag: npx tsdevstack infra:init-ci --envs dev,prod',
    );
  }

  if (environments.length === 0) {
    throw new CliError(
      'No environments specified',
      'infra:init-ci',
      'Provide at least one environment (e.g. dev, staging, prod)',
    );
  }

  const projectName = config.project.name;

  // Generate infrastructure schema
  const schemaPath = path.join(
    projectRoot,
    TSDEVSTACK_DIR,
    INFRASTRUCTURE_SCHEMA_FILENAME,
  );
  writeTextFile(
    schemaPath,
    generateInfrastructureSchema(provider as SchemaProvider),
  );
  logger.info(`Generated ${TSDEVSTACK_DIR}/${INFRASTRUCTURE_SCHEMA_FILENAME}`);

  // Dispatch to provider-specific init
  if (provider === 'gcp') {
    await gcpInitCi(environments, projectName);
  } else if (provider === 'aws') {
    await awsInitCi(environments, projectName);
  } else if (provider === 'azure') {
    await azureInitCi(environments, projectName);
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:init-ci',
      'Supported providers: gcp, aws, azure',
    );
  }
}
