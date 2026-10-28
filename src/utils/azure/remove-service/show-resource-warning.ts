/**
 * Show Resource Warning (Azure)
 *
 * Display warning about resources that will be deleted.
 */

import type { DiscoveredResources } from '../discovery';
import type { CoupledWorkerInfo } from '../discovery';

export interface ShowResourceWarningOptions {
  serviceName: string;
  discovered: DiscoveredResources;
  coupledWorkers: CoupledWorkerInfo[];
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
    logger.info(
      `   Coupled workers: ${coupledWorkers.map((w) => w.name).join(', ')}`,
    );
  }
  if (discovered.containerApp) {
    logger.info(`   Container App:   ${serviceName}`);
  }
  if (discovered.spaBucket) {
    logger.info(`   Storage Account: ${discovered.spaBucketName}`);
  }
  const secretCount =
    discovered.secrets.length + discovered.serviceVaultSecrets.length;
  if (secretCount > 0) {
    logger.info(`   Secrets:         ${secretCount} found`);
  }
  if (discovered.hasDatabase) {
    logger.info(`   Database:        ${serviceName} (PostgreSQL)`);
  }

  logger.newline();
  logger.warn('Make sure no other services depend on this one!');
}
