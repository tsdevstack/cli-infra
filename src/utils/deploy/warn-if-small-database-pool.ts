/**
 * Warn If Small Database Pool
 *
 * The database pool per instance is the database's connections split over
 * the maximum number of instances. Below MIN_RECOMMENDED_DATABASE_POOL a slow
 * query blocks every other request of the instance; the fix is capacity (a
 * larger tier or fewer instances), so deploys only warn.
 */

import { getContext } from '../../context';
import { MIN_RECOMMENDED_DATABASE_POOL } from '../../constants';

export function warnIfSmallDatabasePool(
  pool: { poolMax: number; dbConnections: number; totalInstances: number },
  dbTier: string,
): void {
  if (pool.poolMax >= MIN_RECOMMENDED_DATABASE_POOL) {
    return;
  }

  const { logger } = getContext();
  logger.warn(
    `Database pool: ${pool.poolMax} connection per instance (${dbTier} allows ${pool.dbConnections} connections, shared by up to ${pool.totalInstances} instances)`,
  );
  logger.info(
    "   One slow query blocks the instance's other requests. Use a larger database tier, or lower maxInstances in .tsdevstack/infrastructure.json.",
  );
}
