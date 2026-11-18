/**
 * One line for a saved database file (infra:restore-database's list)
 */

import type { DbExportFile } from './types';

/**
 * When, why and how big: "2026-11-14 12:30:00 UTC  removed         1.2 MB"
 *
 * @param file - A saved file
 * @returns The line
 */
export function formatDbExportFile(file: DbExportFile): string {
  const time = file.time
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
  const size =
    file.size < 1024 * 1024
      ? `${Math.max(1, Math.round(file.size / 1024))} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return `${time}  ${file.reason.padEnd(14)}  ${size}`;
}
