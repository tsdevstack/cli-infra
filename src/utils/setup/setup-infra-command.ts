/**
 * Shared Infrastructure Command Setup
 *
 * Common initialization for all infra commands.
 * Loads config, validates provider, loads credentials, resolves environment.
 */

import type {
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { resolveAWSAccountId } from '../aws/resolve-aws-account-id';
import { loadInfrastructureConfig } from '../infrastructure/load-infrastructure-config';
import { validateInfrastructureConfig } from '../infrastructure/validate-infrastructure-config';
import { INFRASTRUCTURE_VALIDATING_COMMANDS } from '../../constants';

interface CommandOptions {
  env?: string;
}

export interface InfraCommandContext {
  projectRoot: string;
  projectName: string;
  provider: 'gcp' | 'aws' | 'azure';
  targetEnv: string;
  credentials: GCPCredentials | AWSCredentials | AzureCredentials;
  runningInCI: boolean;
}

/**
 * Set up infrastructure command context
 */
export async function setupInfraCommand(
  options: CommandOptions,
  commandName: string,
): Promise<InfraCommandContext> {
  const {
    loadFrameworkConfig,
    findProjectRoot,
    loadCredentialsFile,
    getAvailableEnvironments,
    CliError,
    isCIEnv,
    getGCPCredentialsFromEnv,
    getAWSCredentialsFromEnv,
    getAzureCredentialsFromEnv,
    resolveEnvironment,
  } = getContext();

  const runningInCI = isCIEnv();
  const projectRoot = findProjectRoot();
  const config = loadFrameworkConfig();
  const projectName = config.project.name;
  const provider = config.cloud.provider;

  if (!provider) {
    throw new CliError(
      'No cloud provider configured',
      commandName,
      'Run: npx tsdevstack infra:init first',
    );
  }

  if (provider !== 'gcp' && provider !== 'aws' && provider !== 'azure') {
    throw new CliError(
      `Provider '${provider}' is not yet supported`,
      commandName,
      'Supported providers: gcp, aws, azure',
    );
  }

  // Commands that build or deploy fail here on an invalid infrastructure.json
  // instead of half-way through Terraform or a provider API call
  if (
    (INFRASTRUCTURE_VALIDATING_COMMANDS as readonly string[]).includes(
      commandName,
    )
  ) {
    const infraConfig = loadInfrastructureConfig();
    if (infraConfig) {
      validateInfrastructureConfig(infraConfig);
    }
  }

  let credentials: GCPCredentials | AWSCredentials | AzureCredentials;
  let targetEnv: string;

  if (runningInCI) {
    targetEnv = await resolveEnvironment(options, [], commandName);
    if (provider === 'gcp') {
      credentials = getGCPCredentialsFromEnv();
    } else if (provider === 'aws') {
      credentials = getAWSCredentialsFromEnv();
      // OIDC doesn't set AWS_ACCOUNT_ID — resolve from STS
      await resolveAWSAccountId(credentials as AWSCredentials);
    } else {
      credentials = getAzureCredentialsFromEnv();
    }
  } else {
    let allCredentials: Record<string, unknown>;
    try {
      allCredentials = loadCredentialsFile(projectRoot, provider);
    } catch {
      throw new CliError(
        `No ${provider.toUpperCase()} credentials found`,
        commandName,
        'Run: npx tsdevstack cloud:init first',
      );
    }

    const availableEnvs = getAvailableEnvironments(projectRoot, provider);

    if (availableEnvs.length === 0) {
      throw new CliError(
        'No environments configured',
        commandName,
        'Run: npx tsdevstack cloud:init to add an environment',
      );
    }

    targetEnv = await resolveEnvironment(options, availableEnvs, commandName);
    if (provider === 'gcp') {
      credentials = allCredentials[targetEnv] as GCPCredentials;
    } else if (provider === 'aws') {
      credentials = allCredentials[targetEnv] as AWSCredentials;
    } else {
      credentials = allCredentials[targetEnv] as AzureCredentials;
    }
  }

  return {
    projectRoot,
    projectName,
    provider,
    targetEnv,
    credentials,
    runningInCI,
  };
}
