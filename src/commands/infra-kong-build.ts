/**
 * infra:build-kong Command
 *
 * Builds Kong Docker image with resolved configuration baked in.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';
import { getContext } from '../context';
import { checkDockerInstalled, getGitSha } from '../utils/docker';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { fetchSecret } from '../utils/credentials/fetch-secret';
import { extractPlaceholders } from '../utils/kong/extract-placeholders';
import { resolveEnvVarsStrict } from '../utils/kong/resolve-env-vars-strict';
import { generateKongDockerfile } from '../utils/kong/generate-kong-dockerfile';
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
import { getTerraformOutput } from '../utils/aws/terraform';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../utils/build-runtime';
import type {
  KongTemplate,
  JsonValue,
  GCPCredentials,
  AWSCredentials,
  AzureCredentials,
} from 'tsdevstack/plugin';

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
  const { logger, CliError, readYamlFile, processCorsOrigins } = getContext();

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

  // AWS: These values come from Terraform output, not Secrets Manager
  const terraformOutputSecrets =
    provider === 'aws' ? ['WAKEUP_LAMBDA_URL', 'WAKEUP_SECRET'] : [];

  for (const placeholder of placeholders) {
    // Skip Terraform output secrets - they're fetched separately below
    if (terraformOutputSecrets.includes(placeholder)) {
      missing.push(placeholder);
      continue;
    }

    const value = fetchSecret(placeholder, targetEnv);
    if (value) {
      secrets[placeholder] = value;
      logger.success(`${placeholder}`);
    } else {
      missing.push(placeholder);
      logger.error(`${placeholder} (not found)`);
    }
  }

  // For AWS: fetch values from Terraform output (not stored in Secrets Manager)
  if (provider === 'aws') {
    const runtime = buildRuntime();
    const tfEnv = buildAwsTerraformEnv(
      runtime,
      ctx.credentials as AWSCredentials,
    );

    if (missing.includes('WAKEUP_LAMBDA_URL')) {
      logger.generating('Fetching WAKEUP_LAMBDA_URL from Terraform output...');
      try {
        const lambdaUrl = getTerraformOutput(
          terraformDir,
          'wakeup_lambda_url',
          tfEnv,
        );
        if (lambdaUrl) {
          secrets['WAKEUP_LAMBDA_URL'] = lambdaUrl;
          const idx = missing.indexOf('WAKEUP_LAMBDA_URL');
          if (idx > -1) missing.splice(idx, 1);
          logger.success(`WAKEUP_LAMBDA_URL (from Terraform output)`);
        }
      } catch {
        logger.error('WAKEUP_LAMBDA_URL (not in Terraform state)');
      }
    }

    if (missing.includes('WAKEUP_SECRET')) {
      logger.generating('Fetching WAKEUP_SECRET from Terraform output...');
      try {
        const wakeupSecret = getTerraformOutput(
          terraformDir,
          'wakeup_secret',
          tfEnv,
        );
        if (wakeupSecret) {
          secrets['WAKEUP_SECRET'] = wakeupSecret;
          const idx = missing.indexOf('WAKEUP_SECRET');
          if (idx > -1) missing.splice(idx, 1);
          logger.success(`WAKEUP_SECRET (from Terraform output)`);
        }
      } catch {
        logger.error('WAKEUP_SECRET (not in Terraform state)');
      }
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
    // Write resolved config
    const resolvedConfigPath = path.join(tempDir, 'kong.yml');
    fs.writeFileSync(
      resolvedConfigPath,
      yaml.dump(resolvedConfig, { lineWidth: -1 }),
    );

    // Write Dockerfile
    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(dockerfilePath, generateKongDockerfile());

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
