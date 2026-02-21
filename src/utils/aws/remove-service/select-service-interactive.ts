/**
 * Select Service Interactively (AWS)
 *
 * Prompt user to select a service from deployed services.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { listEcsServices } from '../discovery/list-ecs-services';
import { listAppRunnerServices } from '../discovery/list-apprunner-services';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface SelectServiceInteractiveOptions {
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
}

/**
 * Interactively select a service to remove
 */
export async function selectServiceInteractive(
  options: SelectServiceInteractiveOptions,
): Promise<string> {
  const { CliError } = getContext();
  const { projectName, credentials } = options;

  const clusterName = `${projectName}-cluster`;

  // List ECS services
  const ecsResult = await listEcsServices({
    clusterName,
    credentials,
  });

  // List App Runner services
  const appRunnerResult = await listAppRunnerServices({
    projectName,
    credentials,
  });

  const serviceNames = new Set<string>();

  // Extract service names from ECS
  if (ecsResult.success && ecsResult.services) {
    for (const serviceInfo of ecsResult.services) {
      // Use the serviceName field which already has the project prefix removed
      const name = serviceInfo.serviceName;
      // Skip kong
      if (name !== 'kong') {
        serviceNames.add(name);
      }
    }
  }

  // Extract service names from App Runner
  if (appRunnerResult.success && appRunnerResult.services) {
    for (const serviceInfo of appRunnerResult.services) {
      serviceNames.add(serviceInfo.serviceName);
    }
  }

  const services = Array.from(serviceNames).sort();

  if (services.length === 0) {
    throw new CliError(
      'No deployed services found',
      'infra:remove-service',
      'Deploy a service first',
    );
  }

  const { selectedService } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedService',
      message: 'Select service to remove:',
      choices: services,
    },
  ]);

  return selectedService;
}
