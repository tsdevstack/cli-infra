/**
 * GCP Generate Handler
 */

import { getContext } from '../../../context';
import { generateTerraformFiles } from './generate-terraform-files';
import type { GCPCommandContext } from './types';

/**
 * Generate GCP infrastructure configuration files
 */
export async function gcpGenerate(ctx: GCPCommandContext): Promise<void> {
  const { logger } = getContext();

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`GCP Project: ${ctx.credentials.project_id}`);
  logger.info(`Region: ${ctx.credentials.region}`);
  logger.newline();

  const { outputDir } = generateTerraformFiles(ctx, 'infra:generate', {
    verbose: true,
  });

  logger.newline();
  logger.complete('Configuration files generated!');
  logger.newline();

  logger.info(`Output: ${outputDir}`);
  logger.newline();

  logger.info('Next steps:');
  logger.info(`  npx tsdevstack infra:plan --env ${ctx.targetEnv}`);
  logger.info(`  npx tsdevstack infra:deploy --env ${ctx.targetEnv}`);
  logger.newline();
}
