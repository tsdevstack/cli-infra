/**
 * After infra:remove-service dropped a database: where its data still is
 */

import { getContext } from '../../context';
import { REMOVED_SERVICE_DATA_DOCS_URL } from '../../constants';

export interface DatabaseRecoveryHint {
  /** The server it was on: "the shared Cloud SQL instance" */
  server: string;
  /** Where the data still is: "the instance's backups (7 days, if backup is on)" */
  backups: string;
  /** Restoring into a new server: "clone the instance to a time just before the removal" */
  restore: string;
  /** A warning about restoring onto the live server, where the cloud allows it */
  inPlaceWarning?: string;
  /** Console or portal lines */
  links: string[];
}

/**
 * Every cloud's backups cover the whole database server, so the way back is
 * a restore into a new server, then a copy of the one database into the
 * live server. Restoring onto the live server (possible on GCP) would roll
 * back every service's database.
 *
 * @param serviceName - The service whose database was dropped
 * @param hint - The cloud's wording
 */
export function logDatabaseRecoveryHint(
  serviceName: string,
  hint: DatabaseRecoveryHint,
): void {
  const { logger } = getContext();

  logger.info(
    `Database "${serviceName}" has been dropped from ${hint.server}.`,
  );
  logger.newline();
  logger.info(`Its data is now only in ${hint.backups}. To get it back,`);
  logger.info(
    `${hint.restore}, then copy the "${serviceName}" database from it into the live one.`,
  );
  if (hint.inPlaceWarning) {
    logger.warn(hint.inPlaceWarning);
  }
  for (const link of hint.links) {
    logger.info(`  ${link}`);
  }
  logger.info(`  Guide: ${REMOVED_SERVICE_DATA_DOCS_URL}`);
  logger.newline();
}
