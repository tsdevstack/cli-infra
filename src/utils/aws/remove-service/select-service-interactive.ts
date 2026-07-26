/**
 * Select Service Interactively (AWS)
 *
 * Prompt user to select a service from deployed services.
 */

import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { listEcsServices } from '../discovery/list-ecs-services';
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

  // List ECS services (includes backends, workers, and Next.js)
  const ecsResult = await listEcsServices({
    clusterName,
    credentials,
  });

  const serviceNames = new Set<string>();

  // Extract service names from ECS
  if (ecsResult.success && ecsResult.services) {
    for (const serviceInfo of ecsResult.services) {
      const name = serviceInfo.serviceName;
      // Skip kong
      if (name !== 'kong') {
        serviceNames.add(name);
      }
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
      type: 'select',
      name: 'selectedService',
      message: 'Select service to remove:',
      choices: services,
    },
  ]);

  return selectedService;
}
