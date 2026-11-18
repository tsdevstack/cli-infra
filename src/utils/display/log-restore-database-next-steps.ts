/**
 * After infra:restore-database (every cloud)
 */

import { getContext } from '../../context';

/**
 * How to undo the restore (the file it saved first), and the migrations
 * when the service's code is newer than the restored file
 *
 * @param serviceName - The service
 * @param targetEnv - Environment
 * @param beforeRestoreFile - The file the restore saved first
 */
export function logRestoreDatabaseNextSteps(
  serviceName: string,
  targetEnv: string,
  beforeRestoreFile: string,
): void {
  const { logger } = getContext();

  logger.info('To undo it, restore the file saved just before:');
  logger.info(
    `  npx tsdevstack infra:restore-database ${serviceName} --env ${targetEnv} --file ${beforeRestoreFile}`,
  );
  logger.info("If the service's migrations are newer than the restored file:");
  logger.info(
    `  npx tsdevstack infra:run-db-migrate --service ${serviceName} --env ${targetEnv}`,
  );
  logger.newline();
}
