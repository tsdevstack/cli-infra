/**
 * The service infra:restore-database restores, when none is named (every cloud)
 */

import inquirer from 'inquirer';
import { DB_EXPORT_RETENTION_DAYS } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import type { DbExportFile } from './types';

/**
 * Lists the services that have saved files (only those can be restored),
 * each with its number of files and its newest one, newest first
 *
 * @param files - Every saved file in the bucket, newest first
 * @returns The chosen service
 * @throws CliError when the bucket has no saved files
 */
export async function chooseDbExportService(
  files: DbExportFile[],
): Promise<string> {
  const { CliError } = getContext();

  const services = new Map<string, { count: number; newest: Date }>();
  for (const file of files) {
    const service = services.get(file.serviceName);
    if (service) {
      service.count++;
    } else {
      services.set(file.serviceName, { count: 1, newest: file.time });
    }
  }
  if (services.size === 0) {
    throw new CliError(
      'No saved databases in this environment',
      'infra:restore-database',
      `infra:remove-service saves a service's database before it drops it. Files are kept ${DB_EXPORT_RETENTION_DAYS} days.`,
    );
  }

  const { serviceName } = await inquirer.prompt([
    {
      type: 'select',
      name: 'serviceName',
      message: 'Whose database to restore?',
      choices: [...services].map(([name, { count, newest }]) => ({
        name: `${name}  (${count} saved, newest ${newest
          .toISOString()
          .replace('T', ' ')
          .replace(/\.\d{3}Z$/, ' UTC')})`,
        value: name,
      })),
    },
  ]);
  return serviceName;
}
