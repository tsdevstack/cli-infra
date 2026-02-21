/**
 * Select Deployable Service Interactive
 *
 * Interactively select a deployable service from framework config.
 * Shows only services that can be deployed (nestjs, nextjs, spa).
 */

import inquirer from 'inquirer';
import { getContext } from '../../context';

/**
 * Interactively select a deployable service from framework config
 *
 * @returns Selected service name
 */
export async function selectDeployableService(): Promise<string> {
  const { CliError, loadFrameworkConfig } = getContext();

  const config = loadFrameworkConfig();

  const deployableServices = config.services.filter(
    (s) => s.type === 'nestjs' || s.type === 'nextjs' || s.type === 'spa',
  );

  if (deployableServices.length === 0) {
    throw new CliError(
      'No deployable services found',
      'select-deployable-service',
      'Add services of type nestjs, nextjs, or spa to your config.json',
    );
  }

  const choices = deployableServices.map((service) => ({
    name: `${service.name} (${service.type})`,
    value: service.name,
  }));

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'serviceName',
      message: 'Select service to deploy:',
      choices,
    },
  ]);

  return answer.serviceName;
}
