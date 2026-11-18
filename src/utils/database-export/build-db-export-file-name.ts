/**
 * Name of a saved database file
 */

import { DB_EXPORT_FILE_EXTENSION } from '@tsdevstack/infra-core';
import type { DbExportReason } from './types';

/**
 * {service}/{time}-{reason}.dump, the time in UTC to the second with hyphens
 * for colons (safe in every cloud's object names):
 * auth-service/2026-11-14T12-30-00Z-removed.dump
 *
 * @param serviceName - The service whose database is saved
 * @param reason - Why: `removed` or `before-restore`
 * @param now - The time of the save
 * @returns The file's name in the bucket
 */
export function buildDbExportFileName(
  serviceName: string,
  reason: DbExportReason,
  now: Date = new Date(),
): string {
  const time = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  return `${serviceName}/${time}-${reason}${DB_EXPORT_FILE_EXTENSION}`;
}
