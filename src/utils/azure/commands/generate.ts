/**
 * Azure Generate Handler
 */

import { getContext } from '../../../context';
import { generateTerraformFiles } from './generate-terraform-files';
import type { AzureCommandContext } from './types';
import { resolveAzureNaming } from '../naming/resolve-azure-naming';

/**
 * Generate Azure infrastructure configuration files
 */
export async function azureGenerate(ctx: AzureCommandContext): Promise<void> {
  const { logger } = getContext();

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`Subscription: ${ctx.credentials.subscriptionId}`);
  logger.info(`Location: ${ctx.credentials.location}`);
  logger.newline();

  const naming = await resolveAzureNaming(
    ctx.credentials,
    ctx.projectName,
    ctx.targetEnv,
  );
  const { outputDir } = generateTerraformFiles(ctx, 'infra:generate', {
    naming,
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
