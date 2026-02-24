/**
 * GCP Service Status
 *
 * Check what cloud resources exist for a specific service.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import {
  discoverServiceResources,
  discoverDeployedServices,
} from '../discovery';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

interface GcpServiceStatusParams {
  serviceName: string;
  projectName: string;
  targetEnv: string;
  credentials: GCPCredentials;
}

/**
 * Check cloud resource status for a service on GCP
 */
export async function gcpServiceStatus(
  params: GcpServiceStatusParams,
): Promise<void> {
  const { logger } = getContext();
  const { serviceName, projectName, targetEnv, credentials } = params;

  const sqlInstanceName = `${projectName}-postgres`;

  logger.info(`Service: ${serviceName}`);
  logger.info(`Environment: ${targetEnv}`);
  logger.newline();

  logger.info('Discovering cloud resources...');
  logger.newline();

  const discovered = await discoverServiceResources({
    serviceName,
    projectName,
    projectId: credentials.project_id,
    region: credentials.region,
    sqlInstanceName,
    credentials,
  });

  // Display results
  logger.info(`${serviceName} status in ${targetEnv}:`);
  logger.newline();

  // Cloud Run
  if (discovered.cloudRunService) {
    const url = discovered.cloudRunServiceUrl ?? 'URL not available';
    logger.success(`  Cloud Run: ${url}`);
  } else {
    logger.warn(`  Cloud Run: not found`);
  }

  // Database
  if (discovered.database) {
    logger.success(`  Database: ${serviceName} (PostgreSQL)`);
  } else {
    logger.warn(`  Database: not found`);
  }

  // Secrets
  if (discovered.secrets.length > 0) {
    logger.success(`  Secrets: ${discovered.secrets.length} found`);
  } else {
    logger.warn(`  Secrets: none found`);
  }

  // Service Account
  if (discovered.serviceAccount) {
    logger.success(`  Service Account: ${discovered.serviceAccountEmail}`);
  } else {
    logger.warn(`  Service Account: not found`);
  }

  // SPA Bucket
  if (discovered.spaBucket) {
    logger.success(`  SPA Bucket: ${discovered.spaBucketName}`);
  } else {
    logger.warn(`  SPA Bucket: not found`);
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
export async function selectServiceInteractiveGcp(options: {
  projectName: string;
  credentials: GCPCredentials;
}): Promise<string> {
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const { projectName, credentials } = options;

  const sqlInstanceName = `${projectName}-postgres`;

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
    projectId: credentials.project_id,
    region: credentials.region,
    sqlInstanceName,
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

    let suffix = '';
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
      type: 'list',
      name: 'serviceName',
      message: 'Select service to check:',
      choices,
    },
  ]);

  return answer.serviceName;
}
