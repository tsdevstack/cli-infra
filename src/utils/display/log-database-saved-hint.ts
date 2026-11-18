/**
 * After infra:remove-service saved and dropped a database: where the file is
 * and how to bring it back (every cloud)
 */

import { DB_EXPORT_RETENTION_DAYS } from '@tsdevstack/infra-core';
import { getContext } from '../../context';

/**
 * @param serviceName - The removed service
 * @param targetEnv - Environment it was removed from
 * @param location - The saved file (gs://, s3:// or the blob's URL)
 */
export function logDatabaseSavedHint(
  serviceName: string,
  targetEnv: string,
  location: string,
): void {
  const { logger } = getContext();

  logger.info(
    `Database "${serviceName}" has been dropped. It was saved first, and the file is kept ${DB_EXPORT_RETENTION_DAYS} days:`,
  );
  logger.info(`  ${location}`);
  logger.info(
    'To bring it back, deploy the service again (cloud-secrets:push, infra:deploy), then:',
  );
  logger.info(
    `  npx tsdevstack infra:restore-database ${serviceName} --env ${targetEnv}`,
  );
  logger.newline();
}
