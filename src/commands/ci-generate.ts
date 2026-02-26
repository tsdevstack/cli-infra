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

import { getContext } from '../context';
import { gcpGenerateCiWorkflows } from '../utils/gcp/commands';
import { awsGenerateCiWorkflows } from '../utils/aws/commands';
import { azureGenerateCiWorkflows } from '../utils/azure/commands';

/**
 * Regenerate CI workflows from ci.json
 */
export async function ciGenerate(): Promise<void> {
  const { logger, CliError, loadFrameworkConfig } = getContext();

  logger.newline();
  logger.info('Regenerating CI workflows...');
  logger.newline();

  const config = loadFrameworkConfig();
  const provider = config.cloud.provider;

  if (!provider) {
    throw new CliError(
      'No cloud provider configured',
      'infra:generate-ci',
      'Set cloud.provider in .tsdevstack/config.json or run: npx tsdevstack init',
    );
  }

  if (provider === 'gcp') {
    await gcpGenerateCiWorkflows();
  } else if (provider === 'aws') {
    await awsGenerateCiWorkflows();
  } else if (provider === 'azure') {
    await azureGenerateCiWorkflows();
  } else {
    throw new CliError(
      `Unsupported provider: ${provider}`,
      'infra:generate-ci',
      'Supported providers: gcp, aws, azure',
    );
  }

  logger.newline();
  logger.success('CI workflows regenerated successfully!');
  logger.newline();
}
