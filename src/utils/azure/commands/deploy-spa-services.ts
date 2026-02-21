/**
 * Deploy SPA Services to Azure Blob Storage
 *
 * Builds and uploads SPA static files to Azure Blob Storage $web container.
 * Fetches API URL from Terraform outputs and shared secrets from Key Vault
 * to inject as environment variables during the build (SPAs bake env vars into the bundle).
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import { fetchServiceSecrets } from '../../deploy/fetch-service-secrets';
import {
  buildAzureTerraformEnv,
  createAzureCredential,
  parseServiceFilter,
  uploadSpaToAzureStorage,
} from '@tsdevstack/infra-core';
import type { AzureCommandContext } from './types';

interface DeploySpaServicesOptions {
  service?: string;
}

export async function deploySpaServices(
  ctx: AzureCommandContext,
  options: DeploySpaServicesOptions,
): Promise<void> {
  const { logger, loadFrameworkConfig, CliError } = getContext();
  const runtime = buildRuntime();
  const { projectRoot, targetEnv, credentials } = ctx;

  const config = loadFrameworkConfig();
  const tfEnv = buildAzureTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  // Get SPA services
  let spaServices = config.services.filter((s) => s.type === 'spa');

  const serviceFilter = parseServiceFilter(options.service);
  if (serviceFilter) {
    spaServices = spaServices.filter((s) => serviceFilter.includes(s.name));
  }

  if (spaServices.length === 0) {
    logger.warn('No SPA services found to deploy');
    return;
  }

  // Get resource group name and API URL from Terraform outputs
  let resourceGroupName: string;
  try {
    resourceGroupName = getTerraformOutput(
      terraformDir,
      'resource_group_name',
      tfEnv,
    );
  } catch {
    throw new CliError(
      'Resource group name not found in terraform outputs',
      'infra:deploy-services',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  for (const service of spaServices) {
    logger.newline();
    logger.info(`Deploying SPA: ${service.name}...`);

    // Fetch scoped secrets from Key Vault (SPAs bake env vars into the bundle)
    logger.info('  Fetching secrets from Key Vault...');
    const secrets = fetchServiceSecrets(service.name, config, targetEnv);

    // Get storage account name from Terraform outputs
    const tfId = service.name.replace(/-/g, '_');
    let storageAccountName: string;

    try {
      storageAccountName = getTerraformOutput(
        terraformDir,
        `spa_${tfId}_storage_account`,
        tfEnv,
      );
    } catch {
      throw new CliError(
        `Failed to get storage account for ${service.name}`,
        'infra:deploy-services',
        `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
      );
    }

    // Build the SPA with environment variables
    logger.generating(`  Building ${service.name}...`);
    const buildEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...secrets,
      NODE_ENV: 'production',
    };

    try {
      execSync(`npm run build -w ${service.name}`, {
        cwd: projectRoot,
        stdio: 'inherit',
        env: buildEnv,
      });
    } catch {
      throw new CliError(
        `Failed to build ${service.name}`,
        'infra:deploy-services',
        'Check the build output above for details',
      );
    }

    // Determine build output directory
    const distDir = path.join(projectRoot, 'apps', service.name, 'dist');
    const buildDir = path.join(projectRoot, 'apps', service.name, 'build');
    let sourceDir: string;

    if (fs.existsSync(distDir)) {
      sourceDir = distDir;
    } else if (fs.existsSync(buildDir)) {
      sourceDir = buildDir;
    } else {
      throw new CliError(
        `Build output not found for ${service.name}`,
        'infra:deploy-services',
        `Expected dist/ or build/ directory in apps/${service.name}/`,
      );
    }

    // Upload to Blob Storage $web container
    logger.generating(`  Uploading to Blob Storage (${storageAccountName})...`);

    try {
      const credential = createAzureCredential(runtime, credentials);
      const result = await uploadSpaToAzureStorage(runtime, {
        storageAccountName,
        resourceGroupName,
        sourceDir,
        subscriptionId: credentials.subscriptionId,
        credential,
      });

      logger.success(
        `  ${service.name} deployed to Blob Storage (${result.filesUploaded} files)`,
      );
      if (result.filesDeleted > 0) {
        logger.info(`  Deleted ${result.filesDeleted} stale files`);
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      throw new CliError(
        `Failed to upload ${service.name} to Blob Storage`,
        'infra:deploy-services',
        msg,
      );
    }
  }
}
