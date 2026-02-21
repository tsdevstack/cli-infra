/**
 * Select Service Interactive
 *
 * Interactively select a service from deployed services in cloud.
 * Shows services discovered from cloud + config, with indicators showing source.
 * Allows free-text input for services not in list.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { discoverDeployedServices } from '../discovery';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface SelectServiceInteractiveOptions {
  projectName: string;
  projectId: string;
  region: string;
  sqlInstanceName: string;
  credentials: GCPCredentials;
}

/**
 * Interactively select a service from deployed services in cloud
 *
 * Shows services discovered from cloud + config, with indicators showing source.
 * Allows free-text input for services not in list (e.g., already removed from config).
 *
 * @returns Selected service name
 */
export async function selectServiceInteractive(
  options: SelectServiceInteractiveOptions,
): Promise<string> {
  const { logger, CliError, loadFrameworkConfig } = getContext();

  logger.info('Discovering deployed services...');
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
    projectName: options.projectName,
    projectId: options.projectId,
    region: options.region,
    sqlInstanceName: options.sqlInstanceName,
    credentials: options.credentials,
  });

  if (discoveryResult.success) {
    for (const service of discoveryResult.services) {
      cloudServices.push(service.name);
    }
  }

  // Combine and deduplicate - only show deployed services for removal
  // (config-only services can't be removed from cloud)
  const deployedServices = Array.from(new Set(cloudServices)).sort();

  if (deployedServices.length === 0) {
    throw new CliError(
      'No deployed services found',
      'infra:remove-service',
      'No services found deployed in cloud. Nothing to remove.',
    );
  }

  // Build choices with source indicator
  const choices = deployedServices.map((name) => {
    const inConfig = configServices.includes(name);

    let suffix = '';
    if (inConfig) {
      suffix = ' (config + deployed)';
    } else {
      suffix = ' (deployed only - not in config)';
    }

    return {
      name: `${name}${suffix}`,
      value: name,
    };
  });

  // Add option to enter custom name (for edge cases)
  choices.push({
    name: '[ Enter service name manually ]',
    value: '__manual__',
  });

  const { selectedService } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedService',
      message: 'Select service to remove:',
      choices,
    },
  ]);

  // If manual entry selected, prompt for name
  if (selectedService === '__manual__') {
    const { enteredServiceName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'enteredServiceName',
        message: 'Enter service name to remove:',
        validate: (input: string) => {
          if (!input || !input.trim()) {
            return 'Service name is required';
          }
          // Basic validation: kebab-case
          if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(input.trim())) {
            return 'Service name must be kebab-case (e.g., order-service)';
          }
          return true;
        },
      },
    ]);
    return enteredServiceName.trim();
  }

  return selectedService;
}
