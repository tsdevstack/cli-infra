/**
 * Show Resource Warning (AWS)
 *
 * Display warning about resources that will be deleted.
 */

import type { DiscoveredResources } from '../discovery';

export interface ShowResourceWarningOptions {
  serviceName: string;
  discovered: DiscoveredResources;
  coupledWorkers: string[]; // AWS just needs worker names
  targetEnv: string;
  dryRun?: boolean;
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
  const { serviceName, discovered, coupledWorkers, targetEnv, dryRun, logger } =
    options;
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
  if (discovered.secrets.length > 0) {
    logger.info(`   Secrets:         ${discovered.secrets.length} found`);
  }
  logger.info(`   Database:        ${serviceName} (if exists) ← DATA LOST`);

  logger.newline();
  logger.warn('Make sure no other services depend on this one!');
}
