/**
 * Set up the environment's Terraform folder before a command changes things
 * (infra:remove-service, infra:restore-database)
 */

import fs from 'node:fs';
import path from 'node:path';
import { getContext } from '../../context';
import { executeTerraform } from '@tsdevstack/infra-core';

/**
 * The database steps read Terraform outputs (where db-init runs, as whom,
 * the exports bucket), and outputs need the state backend set up. A folder
 * this machine didn't deploy from (CI, another computer) has no backend yet,
 * and the outputs fail. This runs `terraform init -reconfigure` before
 * anything changes. A project without the Terraform folder is left as it is.
 *
 * @param options.projectRoot - Project root
 * @param options.targetEnv - Environment
 * @param options.env - The cloud's Terraform environment (credentials)
 * @param options.command - The command, for the error (default
 *   infra:remove-service)
 * @throws CliError when init fails: nothing has changed yet
 */
export async function initTerraformBeforeChanges(options: {
  projectRoot: string;
  targetEnv: string;
  env: Record<string, string>;
  command?: string;
}): Promise<void> {
  const { logger, CliError } = getContext();
  const terraformDir = path.join(
    options.projectRoot,
    'infrastructure',
    'terraform',
    options.targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    return;
  }

  logger.info('Setting up Terraform...');
  const result = await executeTerraform('init', {
    workDir: terraformDir,
    env: options.env,
    reconfigure: true,
  });
  if (!result.success) {
    throw new CliError(
      'Terraform init failed. Nothing was changed.',
      options.command ?? 'infra:remove-service',
      result.error ||
        'Check the Terraform output above, then run the command again.',
    );
  }
  logger.newline();
}
