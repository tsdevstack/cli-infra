/**
 * The saved file infra:restore-database restores (every cloud)
 */

import inquirer from 'inquirer';
import { DB_EXPORT_RETENTION_DAYS } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import { formatDbExportFile } from './format-db-export-file';
import type { DbExportFile } from './types';

export interface ChooseDbExportFileOptions {
  serviceName: string;
  /** The service's files, newest first */
  files: DbExportFile[];
  /** --file: the file's name in the bucket */
  fileOption?: string;
  /** A terminal: list the files to pick from */
  interactive: boolean;
}

/**
 * --file wins. Otherwise the newest file saved by infra:remove-service,
 * never a `before-restore` one: a restore saves one of those first, and
 * running it twice must not restore that copy. A terminal lists every file,
 * that one preselected; picking a `before-restore` file undoes a restore.
 *
 * @param options - The files and how to choose
 * @returns The file to restore
 * @throws CliError when there is no file to restore
 */
export async function chooseDbExportFile(
  options: ChooseDbExportFileOptions,
): Promise<DbExportFile> {
  const { CliError } = getContext();
  const { serviceName, files } = options;
  const names = files.map((file) => file.name);

  if (options.fileOption) {
    const named = files.find((file) => file.name === options.fileOption);
    if (!named) {
      throw new CliError(
        `No saved file ${options.fileOption}`,
        'infra:restore-database',
        names.length > 0
          ? `Saved files of ${serviceName}: ${names.join(', ')}`
          : `${serviceName} has no saved files (they are kept ${DB_EXPORT_RETENTION_DAYS} days).`,
      );
    }
    return named;
  }

  if (files.length === 0) {
    throw new CliError(
      `${serviceName} has no saved files`,
      'infra:restore-database',
      `infra:remove-service saves a service's database before it drops it. Files are kept ${DB_EXPORT_RETENTION_DAYS} days.`,
    );
  }

  const preferred = files.find((file) => file.reason === 'removed');
  if (!options.interactive) {
    if (!preferred) {
      throw new CliError(
        `${serviceName} has no file saved by infra:remove-service`,
        'infra:restore-database',
        `Name the file with --file. Saved files: ${names.join(', ')}`,
      );
    }
    return preferred;
  }

  const { name } = await inquirer.prompt([
    {
      type: 'select',
      name: 'name',
      message: `Which saved file of ${serviceName}?`,
      choices: files.map((file) => ({
        name: formatDbExportFile(file),
        value: file.name,
      })),
      default: (preferred ?? files[0]).name,
    },
  ]);
  return files.find((file) => file.name === name) ?? files[0];
}
