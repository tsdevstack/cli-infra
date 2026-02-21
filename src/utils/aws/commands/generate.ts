/**
 * AWS Generate Handler
 */

import { getContext } from '../../../context';
import { generateTerraformFiles } from './generate-terraform-files';
import type { AWSCommandContext } from './types';

/**
 * Generate AWS infrastructure configuration files
 */
export async function awsGenerate(ctx: AWSCommandContext): Promise<void> {
  const { logger } = getContext();

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`AWS Account: ${ctx.credentials.accountId}`);
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
