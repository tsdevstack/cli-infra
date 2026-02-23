/**
 * infra:generate-ci Command
 *
 * Regenerates GitHub workflows from existing ci.json configuration.
 * Use after updating ci.json or when workflows need to be refreshed.
 *
 * Generates:
 * - pr.yml - PR checks
 * - deploy.yml - Full deployment (legacy, for backwards compatibility)
 * - deploy-services.yml - Services with boolean checkboxes
 * - deploy-infra.yml - Infrastructure only
 * - deploy-kong.yml - Kong Gateway only
 * - deploy-lb.yml - Load Balancer only
 * - deploy-scheduled-jobs.yml - Scheduled jobs (Cloud Scheduler)
 * - remove-service.yml - Service removal (cloud)
 * - remove-detached-worker.yml - Orphaned worker removal (cloud)
 */

import * as path from 'path';
import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpGenerateCiWorkflows } from '../utils/gcp/commands';
import { awsGenerateCiWorkflows } from '../utils/aws/commands';
import { azureGenerateCiWorkflows } from '../utils/azure/commands';

interface CiGenerateOptions {
  env?: string;
  framework?: boolean;
}

/**
 * Regenerate CI workflows from ci.json
 */
export async function ciGenerate(options: CiGenerateOptions): Promise<void> {
  const { logger, CliError, findProjectRoot, isFile } = getContext();

  // Guard: --framework only works inside the framework monorepo
  if (options.framework) {
    const projectRoot = findProjectRoot();
    const isFrameworkRepo = isFile(
      path.join(projectRoot, 'packages/cli-core/package.json'),
    );
    if (!isFrameworkRepo) {
      throw new CliError(
        '--framework flag is only available in the tsdevstack framework monorepo',
        'infra:generate-ci',
      );
    }
  }

  logger.newline();
  logger.info('Regenerating CI workflows...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:generate-ci');

  if (ctx.provider === 'gcp') {
    await gcpGenerateCiWorkflows(options.framework);
  } else if (ctx.provider === 'aws') {
    await awsGenerateCiWorkflows(options.framework);
  } else if (ctx.provider === 'azure') {
    await azureGenerateCiWorkflows(options.framework);
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:generate-ci',
      'Supported providers: gcp, aws, azure',
    );
  }

  logger.newline();
  logger.success('CI workflows regenerated successfully!');
  logger.newline();
}
