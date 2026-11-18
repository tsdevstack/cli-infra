/**
 * Show Resource Warning (AWS)
 *
 * Display warning about resources that will be deleted.
 */

import { DB_EXPORT_RETENTION_DAYS } from '@tsdevstack/infra-core';
import type { DiscoveredResources } from '../discovery';

export interface ShowResourceWarningOptions {
  serviceName: string;
  discovered: DiscoveredResources;
  coupledWorkers: string[]; // AWS just needs worker names
  targetEnv: string;
  dryRun?: boolean;
  /** The database is saved before it is dropped */
  databaseSaved?: boolean;
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
    databaseSaved,
    skipExport,
    logger,
  } = options;
  const action = dryRun ? 'WOULD DELETE' : 'will PERMANENTLY DELETE';

  logger.newline();
  logger.warn(`WARNING: This ${action} from ${targetEnv}:`);
  logger.newline();

  if (coupledWorkers.length > 0) {
    logger.info(`   Coupled workers: ${coupledWorkers.join(', ')}`);
  }
  if (discovered.ecsService) {
    logger.info(`   ECS Service:     ${serviceName}`);
  }
  if (discovered.spaBucket) {
    logger.info(`   S3 Bucket:       ${discovered.spaBucketName}`);
  }

  for (const distribution of discovered.cloudFrontDistributions) {
    logger.info(
      `   CloudFront:      ${distribution.id} (takes several minutes: disabled, then deleted)`,
    );
  }
  if (discovered.secrets.length > 0) {
    logger.info(`   Secrets:         ${discovered.secrets.length} found`);
  }
  logger.info(
    databaseSaved
      ? `   Database:        ${serviceName} (PostgreSQL) ← saved first, the file kept ${DB_EXPORT_RETENTION_DAYS} days`
      : `   Database:        ${serviceName} (if exists) ← DATA LOST${skipExport ? ' (--skip-export)' : ''}`,
  );

  logger.newline();
  logger.warn('Make sure no other services depend on this one!');
}
