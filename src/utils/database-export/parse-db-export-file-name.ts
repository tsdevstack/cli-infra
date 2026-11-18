/**
 * Read a saved database file's name
 */

import type { DbExportFileName } from './types';

const FILE_NAME =
  /^([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-(removed|before-restore)\.dump$/;

/**
 * The service, time and reason in a name buildDbExportFileName made
 *
 * @param name - The file's name in the bucket
 * @returns What the name says, or null for any other file
 */
export function parseDbExportFileName(name: string): DbExportFileName | null {
  const match = FILE_NAME.exec(name);
  if (!match) return null;
  const [, serviceName, date, hours, minutes, seconds, reason] = match;
  const time = new Date(`${date}T${hours}:${minutes}:${seconds}Z`);
  if (Number.isNaN(time.getTime())) return null;
  return {
    name,
    serviceName,
    time,
    reason: reason as DbExportFileName['reason'],
  };
}
