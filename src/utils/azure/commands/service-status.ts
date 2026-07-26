/**
 * Azure Service Status
 *
 * Check what cloud resources exist for a specific service.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import {
  discoverServiceResources,
  discoverDeployedServices,
} from '../discovery';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

interface AzureServiceStatusParams {
  serviceName: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

/**
 * Check cloud resource status for a service on Azure
 */
export async function azureServiceStatus(
  params: AzureServiceStatusParams,
): Promise<void> {
  const { logger } = getContext();
  const { serviceName, projectName, targetEnv, credentials } = params;

  logger.info(`Service: ${serviceName}`);
  logger.info(`Environment: ${targetEnv}`);
  logger.newline();

  logger.info('Discovering cloud resources...');
  logger.newline();

  const discovered = await discoverServiceResources({
    serviceName,
    projectName,
    targetEnv,
    credentials,
  });

  // Display results
  logger.info(`${serviceName} status in ${targetEnv}:`);
  logger.newline();

  // Container App
  if (discovered.containerApp) {
    const url = discovered.containerAppUrl ?? 'URL not available';
    logger.success(`  Container App:    ✓ ${url}`);
    if (discovered.containerAppReplicas !== undefined) {
      logger.info(`  Replicas:         ${discovered.containerAppReplicas}`);
    }
  } else {
    logger.info(`  Container App:    ✗ not found`);
  }

  // Database
  if (discovered.hasDatabase) {
    logger.success(`  Database:         ✓ ${serviceName} (PostgreSQL)`);
  } else {
    logger.info(`  Database:         ✗ not found`);
  }

  // Secrets
  if (discovered.secrets.length > 0) {
    logger.success(`  Secrets:          ✓ ${discovered.secrets.length} found`);
  } else {
    logger.info(`  Secrets:          ✗ none found`);
  }

  // SPA Bucket
  if (discovered.spaBucket) {
    logger.success(`  Storage Account:  ✓ ${discovered.spaBucketName}`);
  } else {
    logger.info(`  Storage Account:  ✗ not found`);
  }

  logger.newline();

  // Show detected type
  if (discovered.inferredType !== 'unknown') {
    logger.info(`  Detected type: ${discovered.inferredType}`);
  } else {
    logger.warn(`  Detected type: unknown (no resources found)`);
  }

  logger.newline();
}

/**
 * Interactively select a service from combined config + cloud discovery
 */
export async function selectServiceInteractiveAzure(options: {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}): Promise<string> {
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const { projectName, targetEnv, credentials } = options;

  logger.info('Gathering available services...');
  logger.newline();

  // Get services from config.json
  const configServices: string[] = [];
  try {
    const config = loadFrameworkConfig();
    for (const service of config.services) {
      configServices.push(service.name);
    }
  } catch {
    // Config might not have services, continue with cloud discovery
  }

  // Get services from cloud discovery
  const cloudServices: string[] = [];
  const discoveryResult = await discoverDeployedServices({
    projectName,
    targetEnv,
    credentials,
  });

  if (discoveryResult.success) {
    for (const service of discoveryResult.services) {
      cloudServices.push(service.name);
    }
  }

  // Combine and deduplicate
  const allServices = Array.from(
    new Set([...configServices, ...cloudServices]),
  ).sort();

  if (allServices.length === 0) {
    throw new CliError(
      'No services found',
      'infra:service-status',
      'No services in config.json and no deployed services found in cloud',
    );
  }

  // Build choices with source indicator
  const choices = allServices.map((name) => {
    const inConfig = configServices.includes(name);
    const inCloud = cloudServices.includes(name);

    let suffix: string;
    if (inConfig && inCloud) {
      suffix = ' (config + deployed)';
    } else if (inConfig) {
      suffix = ' (config only)';
    } else {
      suffix = ' (deployed only)';
    }

    return {
      name: `${name}${suffix}`,
      value: name,
    };
  });

  const answer = await inquirer.prompt([
    {
      type: 'select',
      name: 'serviceName',
      message: 'Select service to check:',
      choices,
    },
  ]);

  return answer.serviceName;
}
