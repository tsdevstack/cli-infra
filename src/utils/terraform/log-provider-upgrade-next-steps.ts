/**
 * Next steps after infra:plan --upgrade
 */

import path from 'node:path';
import { getContext } from '../../context';

/**
 * The upgrade only changed the lock file. The new provider versions apply on
 * the next deploy, and CI picks them up once the lock file is committed.
 *
 * @param outputDir - The environment's Terraform directory
 * @param targetEnv - Environment name
 */
export function logProviderUpgradeNextSteps(
  outputDir: string,
  targetEnv: string,
): void {
  const { logger } = getContext();
  const lockFile = path.relative(
    process.cwd(),
    path.join(outputDir, '.terraform.lock.hcl'),
  );

  logger.newline();
  logger.info('Terraform providers upgraded. Nothing is applied yet.');
  logger.info('Review the plan above. If it looks right:');
  logger.info(`  1. Commit ${lockFile}`);
  logger.info(`  2. npx tsdevstack infra:deploy --env ${targetEnv}`);
  logger.newline();
}
