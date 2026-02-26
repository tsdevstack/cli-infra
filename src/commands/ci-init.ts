/**
 * infra:init-ci Command
 *
 * Initializes CI/CD by creating ci.json and generating GitHub workflows.
 * Creates config, generates workflows, prints setup instructions.
 *
 * Generates:
 * - pr.yml - PR checks
 * - deploy.yml - Full deployment (legacy)
 * - deploy-services.yml - Services with boolean checkboxes
 * - deploy-infra.yml - Infrastructure only
 * - deploy-kong.yml - Kong Gateway only
 * - deploy-lb.yml - Load Balancer only
 * - remove-service.yml - Service removal (cloud)
 */

import { getContext } from '../context';
import { setupInfraCommand } from '../utils/setup/setup-infra-command';
import { gcpInitCi } from '../utils/gcp/commands';
import { awsInitCi } from '../utils/aws/commands';
import { azureInitCi } from '../utils/azure/commands';

interface CiInitOptions {
  github?: boolean;
  env?: string;
}

/**
 * Initialize CI/CD configuration
 */
export async function ciInit(options: CiInitOptions): Promise<void> {
  const { logger, CliError } = getContext();

  // Only GitHub supported for now
  if (!options.github) {
    throw new CliError(
      'CI provider required',
      'infra:init-ci',
      'Use --github flag: npx tsdevstack infra:init-ci --github',
    );
  }

  logger.newline();
  logger.info('Initializing CI/CD for GitHub Actions...');
  logger.newline();

  const ctx = await setupInfraCommand(options, 'infra:init-ci');

  if (ctx.provider === 'gcp') {
    await gcpInitCi();
  } else if (ctx.provider === 'aws') {
    await awsInitCi();
  } else if (ctx.provider === 'azure') {
    await azureInitCi();
  } else {
    throw new CliError(
      `Unsupported provider: ${ctx.provider}`,
      'infra:init-ci',
      'Supported providers: gcp, aws, azure',
    );
  }
}
