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
import { buildKongCollectorImage } from '../utils/kong/build-kong-collector-image';
import { buildKongCollectorConfig } from '../utils/kong/build-kong-collector-config';
import { buildGcpCollectorDestination } from '../utils/kong/gcp/build-gcp-collector-destination';
import { buildAwsCollectorDestination } from '../utils/kong/aws/build-aws-collector-destination';
import { buildAzureCollectorDestination } from '../utils/kong/azure/build-azure-collector-destination';
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
  /**
   * Print the commands to run next (default true). infra:deploy passes
   * false: it runs them itself.
   */
  nextSteps?: boolean;
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
    validateKongTrustTokenUse,
    buildKongRuntimeSecretReferences,
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
  // A config generated from an older kong.user.yml (infra:generate-kong now
  // stops on those)
  validateKongTrustTokenUse(kongConfig, 'kong.user.yml');
  logger.success('Kong config loaded');

  // Step 2: Extract placeholders
  logger.generating('Extracting placeholders...');
  const placeholders = extractPlaceholders(kongConfig);
  logger.info(`  Found ${placeholders.length} placeholders`);

  // Step 3: Fetch secrets from Secret Manager. Kong's runtime secrets are not
  // fetched: they become env vault references, and the platform gives Kong
  // the values when it starts, so the image never holds them.
  logger.generating('Fetching secrets from Secret Manager...');
  const runtimeSecretReferences = buildKongRuntimeSecretReferences();
  const secrets: Record<string, string> = {};
  const missing: string[] = [];

  for (const placeholder of placeholders) {
    if (placeholder in runtimeSecretReferences) {
      secrets[placeholder] = runtimeSecretReferences[placeholder];
      logger.info(`  ${placeholder} (read by Kong at startup)`);
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

    // Step 8: Build the collector sidecar image (Kong's spans to the cloud's
    // trace service), with this environment's config
    logger.newline();
    const destination =
      provider === 'gcp'
        ? buildGcpCollectorDestination(
            (ctx.credentials as GCPCredentials).project_id,
          )
        : provider === 'aws'
          ? buildAwsCollectorDestination({
              region: (ctx.credentials as AWSCredentials).region,
              logGroup: `/ecs/${ctx.projectName}/kong`,
            })
          : buildAzureCollectorDestination();
    logger.generating('Building the collector sidecar image...');
    const collector = buildKongCollectorImage({
      registryUrl,
      imageTag,
      config: buildKongCollectorConfig(destination),
    });
    logger.success(`Image built: ${collector.fullImageTag}`);

    // Step 9: Push to registry (provider-specific)
    logger.newline();
    const imagesToPush = [
      fullImageTag,
      latestTag,
      collector.fullImageTag,
      collector.latestTag,
    ];

    if (provider === 'gcp') {
      const info = getGcpKongRegistryInfo(
        projectRoot,
        targetEnv,
        ctx.credentials as GCPCredentials,
      );
      for (const image of imagesToPush) {
        await pushGcpKongImage(
          image,
          info.registryHost,
          ctx.credentials as GCPCredentials,
        );
      }
    } else if (provider === 'aws') {
      for (const image of imagesToPush) {
        await pushAwsKongImage(
          image,
          registryUrl,
          ctx.credentials as AWSCredentials,
        );
      }
    } else if (provider === 'azure') {
      for (const image of imagesToPush) {
        await pushAzureKongImage(
          image,
          registryUrl,
          ctx.credentials as AzureCredentials,
        );
      }
    }

    logger.newline();
    logger.complete('Kong and collector images built and pushed!');
    logger.newline();
    logger.info(`Image: ${fullImageTag}`);
    logger.info(`Collector: ${collector.fullImageTag}`);
    logger.newline();
    if (options.nextSteps !== false) {
      logger.info('Next steps:');
      logger.info(`  npx tsdevstack infra:deploy-kong --env ${targetEnv}`);
      logger.newline();
    }
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
