/**
 * infra:build-kong Command
 *
 * Builds Kong Docker image with resolved configuration baked in.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { getContext } from '../context';
import { checkDockerInstalled, getGitSha } from '../utils/docker';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { fetchSecret } from '../utils/credentials/fetch-secret';
import { extractPlaceholders } from '../utils/kong/extract-placeholders';
import { resolveEnvVarsStrict } from '../utils/kong/resolve-env-vars-strict';
import { loadInfrastructureConfig } from '../utils/infrastructure/load-infrastructure-config';
import { getKongConfig } from '../utils/infrastructure/get-kong-config';
import {
  getGcpKongRegistryInfo,
  pushGcpKongImage,
} from '../utils/gcp/commands';
import {
  getAwsKongRegistryInfo,
  pushAwsKongImage,
} from '../utils/aws/commands';
import {
  getAzureKongRegistryInfo,
  pushAzureKongImage,
} from '../utils/azure/commands';
import type {
  KongTemplate,
  JsonValue,
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from '@tsdevstack/cli/plugin';

interface InfraKongBuildOptions {
  env?: string;
  tag?: string;
}

/**
 * Build Kong Docker image with resolved configuration
 */
export async function infraKongBuild(
  options: InfraKongBuildOptions,
): Promise<void> {
  const {
    logger,
    CliError,
    readYamlFile,
    processCorsOrigins,
    writeKongBuildContext,
  } = getContext();

  logger.newline();
  logger.info('Building Kong Docker image...');
  logger.newline();

  // Check prerequisites
  checkDockerInstalled();

  // Set up command context
  const ctx = await setupInfraCommand(options, 'infra:build-kong');
  const { projectRoot, targetEnv, provider } = ctx;

  // Check Kong config exists
  const kongConfigPath = path.join(
    projectRoot,
    'infrastructure',
    'kong',
    targetEnv,
    'kong.yml',
  );
  if (!fs.existsSync(kongConfigPath)) {
    throw new CliError(
      `Kong config not found: ${kongConfigPath}`,
      'infra:build-kong',
      `Run npx tsdevstack infra:generate-kong --env ${targetEnv} first`,
    );
  }

  // Get registry URL from terraform outputs
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'infra:build-kong',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Get registry info (provider-specific)
  let registryUrl: string;

  if (provider === 'gcp') {
    const info = getGcpKongRegistryInfo(
      projectRoot,
      targetEnv,
      ctx.credentials as GCPCredentials,
    );
    registryUrl = info.registryUrl;
  } else if (provider === 'aws') {
    const info = getAwsKongRegistryInfo(
      projectRoot,
      targetEnv,
      ctx.credentials as AWSCredentials,
    );
    registryUrl = info.registryUrl;
  } else if (provider === 'azure') {
    const info = getAzureKongRegistryInfo(
      projectRoot,
      targetEnv,
      ctx.credentials as AzureCredentials,
    );
    registryUrl = info.registryUrl;
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:build-kong',
      'Supported providers: gcp, aws, azure',
    );
  }

  // Get tag
  const imageTag = options.tag ?? getGitSha();

  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Config: ${kongConfigPath}`);
  logger.info(`Registry: ${registryUrl}`);
  logger.info(`Tag: ${imageTag}`);
  logger.newline();

  // Step 1: Read Kong config with placeholders
  logger.generating('Reading Kong configuration...');
  const kongConfig = readYamlFile<KongTemplate>(kongConfigPath);
  logger.success('Kong config loaded');

  // Step 2: Extract placeholders
  logger.generating('Extracting placeholders...');
  const placeholders = extractPlaceholders(kongConfig);
  logger.info(`  Found ${placeholders.length} placeholders`);

  // Step 3: Fetch secrets from Secret Manager
  logger.generating('Fetching secrets from Secret Manager...');
  const secrets: Record<string, string> = {};
  const missing: string[] = [];

  for (const placeholder of placeholders) {
    const value = fetchSecret(placeholder, targetEnv);
    if (value) {
      secrets[placeholder] = value;
      logger.success(`${placeholder}`);
    } else {
      missing.push(placeholder);
      logger.error(`${placeholder} (not found)`);
    }
  }

  if (missing.length > 0) {
    throw new CliError(
      `Missing secrets in Secret Manager: ${missing.join(', ')}`,
      'infra:build-kong',
      `Push these secrets first:\n  npx tsdevstack cloud-secrets:push --env ${targetEnv}`,
    );
  }

  // Step 4: Resolve placeholders
  logger.generating('Resolving placeholders...');
  const resolvedConfig = resolveEnvVarsStrict(
    kongConfig as unknown as JsonValue,
    secrets,
  ) as unknown as KongTemplate;
  logger.success('All placeholders resolved');

  // Step 4b: Post-process CORS origins (convert comma-separated string to array)
  processCorsOrigins(resolvedConfig);

  // Step 4c: Validate no unresolved placeholders remain
  // Only checks single-brace ${...} syntax (double braces ${{...}} are ignored)
  logger.generating('Validating resolved configuration...');
  const configString = yaml.dump(resolvedConfig, { lineWidth: -1 });
  const unresolvedPattern = /\$\{(?!\{)[^}]+\}/g;
  const unresolvedMatches = configString.match(unresolvedPattern);
  if (unresolvedMatches) {
    const unique = Array.from(new Set(unresolvedMatches));
    throw new CliError(
      `Unresolved placeholders in Kong config: ${unique.join(', ')}`,
      'infra:build-kong',
      'Ensure all placeholders have corresponding secrets in Secret Manager',
    );
  }
  logger.success('All placeholders resolved');

  // Step 5: Create temp build directory
  logger.generating('Preparing Docker build context...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kong-build-'));

  try {
    // Load infrastructure config for Kong settings (maxUploadSize)
    const infraConfig = loadInfrastructureConfig();
    const kongConfig = getKongConfig(infraConfig, targetEnv, provider);

    // Write Dockerfile, plugins and the resolved config (baked into the image)
    const kongPlugins = writeKongBuildContext({
      projectRoot,
      contextDir: tempDir,
      maxUploadSize: kongConfig.maxUploadSize,
      kongYml: yaml.dump(resolvedConfig, { lineWidth: -1 }),
    });
    logger.info(`  KONG_PLUGINS=${kongPlugins.join(',')}`);

    logger.success('Build context prepared');

    // Step 6: Build Docker image
    const fullImageTag = `${registryUrl}/kong:${imageTag}`;
    logger.newline();
    logger.generating(`Building image: ${fullImageTag}`);

    execSync(`docker build --platform linux/amd64 -t ${fullImageTag} .`, {
      cwd: tempDir,
      stdio: 'inherit',
    });

    logger.success(`Image built: ${fullImageTag}`);

    // Step 7: Tag as latest
    const latestTag = `${registryUrl}/kong:latest`;
    logger.generating(`Tagging as latest: ${latestTag}`);
    execSync(`docker tag ${fullImageTag} ${latestTag}`, {
      stdio: 'pipe',
    });
    logger.success(`Tagged as latest`);

    // Step 8: Push to registry (provider-specific)
    logger.newline();

    if (provider === 'gcp') {
      const info = getGcpKongRegistryInfo(
        projectRoot,
        targetEnv,
        ctx.credentials as GCPCredentials,
      );
      await pushGcpKongImage(
        fullImageTag,
        info.registryHost,
        ctx.credentials as GCPCredentials,
      );
      await pushGcpKongImage(
        latestTag,
        info.registryHost,
        ctx.credentials as GCPCredentials,
      );
    } else if (provider === 'aws') {
      await pushAwsKongImage(
        fullImageTag,
        registryUrl,
        ctx.credentials as AWSCredentials,
      );
      await pushAwsKongImage(
        latestTag,
        registryUrl,
        ctx.credentials as AWSCredentials,
      );
    } else if (provider === 'azure') {
      await pushAzureKongImage(
        fullImageTag,
        registryUrl,
        ctx.credentials as AzureCredentials,
      );
      await pushAzureKongImage(
        latestTag,
        registryUrl,
        ctx.credentials as AzureCredentials,
      );
    }

    logger.newline();
    logger.complete('Kong image built and pushed!');
    logger.newline();
    logger.info(`Image: ${fullImageTag}`);
    logger.newline();
    logger.info('Next steps:');
    logger.info(`  npx tsdevstack infra:deploy-kong --env ${targetEnv}`);
    logger.newline();
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
