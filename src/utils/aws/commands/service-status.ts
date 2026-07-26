/**
 * AWS Service Status
 *
 * Check what cloud resources exist for a specific service.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import {
  discoverServiceResources,
  discoverDeployedServices,
} from '../discovery';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

interface AwsServiceStatusParams {
  serviceName: string;
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
}

/**
 * Check cloud resource status for a service on AWS
 */
export async function awsServiceStatus(
  params: AwsServiceStatusParams,
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

  // ECS Service
  if (discovered.ecsService) {
    const running = discovered.ecsRunningCount ?? 0;
    const desired = discovered.ecsDesiredCount ?? 0;
    const status = discovered.ecsStatus ?? 'UNKNOWN';
    logger.success(
      `  ECS Service:      ✓ ${status} (${running}/${desired} running)`,
    );

    if (discovered.ecsDeploymentStatus) {
      logger.info(`    Deployment:     ${discovered.ecsDeploymentStatus}`);
    }

    // Show recent events if there are issues
    if (
      discovered.ecsEvents &&
      discovered.ecsEvents.length > 0 &&
      (running !== desired || discovered.ecsDeploymentStatus === 'IN_PROGRESS')
    ) {
      logger.newline();
      logger.info('  Recent events:');
      for (const event of discovered.ecsEvents.slice(0, 3)) {
        const time = event.createdAt
          ? event.createdAt.toISOString().slice(11, 19)
          : '';
        logger.info(`    ${time} ${event.message}`);
      }
    }
  } else {
    logger.info(`  ECS Service:      ✗ not found`);
  }

  // SPA Bucket
  if (discovered.spaBucket) {
    logger.success(`  SPA Bucket:       ✓ ${discovered.spaBucketName}`);
  } else {
    logger.info(`  SPA Bucket:       ✗ not found`);
  }

  // Secrets
  if (discovered.secrets.length > 0) {
    logger.success(`  Secrets:          ✓ ${discovered.secrets.length} found`);
  } else {
    logger.info(`  Secrets:          ✗ none found`);
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
export async function selectServiceInteractiveAws(options: {
  projectName: string;
  credentials: AWSCredentials;
}): Promise<string> {
  const { logger, CliError, loadFrameworkConfig } = getContext();
  const { projectName, credentials } = options;

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
