/**
 * Saved databases (infra:remove-service, infra:restore-database), every cloud
 */

import type { DB_EXPORT_REASONS } from '@tsdevstack/infra-core';

/** Why a file was saved: `removed` or `before-restore` */
export type DbExportReason =
  (typeof DB_EXPORT_REASONS)[keyof typeof DB_EXPORT_REASONS];

/** A saved file, read from its name: {service}/{time}-{reason}.dump */
export interface DbExportFileName {
  /** The file's name in the bucket */
  name: string;
  serviceName: string;
  /** When it was saved */
  time: Date;
  reason: DbExportReason;
}

/** A saved file in the bucket */
export interface DbExportFile extends DbExportFileName {
  /** Size in bytes */
  size: number;
}
