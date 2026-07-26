/**
 * Select Service Interactive (Azure)
 *
 * Interactively select a service from deployed services.
 * Combines config.json services + cloud discovery results.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { discoverDeployedServices } from '../discovery';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

export interface SelectServiceInteractiveOptions {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}

/**
 * Interactively select a service from combined config + cloud discovery
 */
export async function selectServiceInteractive(
  options: SelectServiceInteractiveOptions,
): Promise<string> {
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
      'infra:remove-service',
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
      message: 'Select service to remove:',
      choices,
    },
  ]);

  return answer.serviceName;
}
