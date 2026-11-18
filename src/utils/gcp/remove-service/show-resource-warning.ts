/**
 * Show Resource Warning
 *
 * Display warning about resources that will be deleted.
 */

import { DB_EXPORT_RETENTION_DAYS } from '@tsdevstack/infra-core';
import type { DiscoveredResources } from '../discovery';
import type { CoupledWorkerInfo } from '../discovery';

export interface ShowResourceWarningOptions {
  serviceName: string;
  discovered: DiscoveredResources;
  coupledWorkers: CoupledWorkerInfo[];
  targetEnv: string;
  dryRun?: boolean;
  /** --skip-export: the database is dropped without being saved */
  skipExport?: boolean;
  logger: {
    newline: () => void;
    warn: (msg: string) => void;
    info: (msg: string) => void;
  };
}

/**
 * Show warning about resources to be deleted
 */
export function showResourceWarning(options: ShowResourceWarningOptions): void {
  const {
    serviceName,
    discovered,
    coupledWorkers,
    targetEnv,
    dryRun,
    skipExport,
    logger,
  } = options;
  const action = dryRun ? 'WOULD DELETE' : 'will PERMANENTLY DELETE';

  logger.newline();
  logger.warn(`WARNING: This ${action} from ${targetEnv}:`);
  logger.newline();

  if (coupledWorkers.length > 0) {
    logger.info(
      `   Coupled workers: ${coupledWorkers.map((w) => w.name).join(', ')}`,
    );
  }
  if (discovered.cloudRunService) {
    logger.info(`   Cloud Run:       ${serviceName}`);
  }
  if (discovered.spaBucket) {
    logger.info(`   SPA Bucket:      ${discovered.spaBucketName}`);
  }
  if (discovered.database) {
    logger.info(
      skipExport
        ? `   Database:        ${serviceName} (PostgreSQL) ← DATA LOST (--skip-export)`
        : `   Database:        ${serviceName} (PostgreSQL) ← saved first, the file kept ${DB_EXPORT_RETENTION_DAYS} days`,
    );
  }
  if (discovered.secrets.length > 0) {
    logger.info(`   Secrets:         ${discovered.secrets.length} found`);
  }
  if (discovered.serviceAccount) {
    logger.info(`   Service Account: ${discovered.serviceAccountEmail}`);
  }
  if (discovered.migrationServiceAccount) {
    logger.info(
      `   Migrations SA:   ${discovered.migrationServiceAccountEmail}`,
    );
  }

  logger.newline();
  logger.warn('Make sure no other services depend on this one!');
}
