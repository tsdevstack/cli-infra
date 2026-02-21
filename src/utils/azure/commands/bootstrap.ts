/**
 * Azure Bootstrap Handler
 *
 * Registers resource providers and creates Terraform state backend.
 */

import { getContext } from '../../../context';
import { registerInfraProviders } from '../bootstrap/register-infra-providers';
import { createStateBackend } from '../bootstrap/create-state-backend';
import type { AzureCommandContext } from './types';

/**
 * Bootstrap Azure - register providers and create state backend
 */
export async function azureBootstrap(ctx: AzureCommandContext): Promise<void> {
  const { logger, CliError } = getContext();

  // Step 1: Register resource providers
  logger.info('Step 1/2: Registering Azure resource providers...');
  const registerResult = await registerInfraProviders(ctx.credentials);

  if (!registerResult.success) {
    throw new CliError(
      `Failed to register providers: ${registerResult.error}`,
      'infra:bootstrap',
      'Check your Azure credentials and subscription permissions',
    );
  }

  logger.info(`  Registered ${registerResult.registered.length} providers`);
  logger.newline();

  // Step 2: Create state backend
  logger.info('Step 2/2: Creating Terraform state backend...');
  const stateResult = await createStateBackend({
    projectName: ctx.projectName,
    env: ctx.targetEnv,
    credentials: ctx.credentials,
  });

  if (!stateResult.success) {
    throw new CliError(
      `Failed to create state backend: ${stateResult.error}`,
      'infra:bootstrap',
      'Check your Azure credentials and resource group permissions',
    );
  }

  if (stateResult.storageAccountCreated) {
    logger.success(
      `Created Storage Account: ${stateResult.storageAccountName}`,
    );
  } else {
    logger.success(
      `Storage Account already exists: ${stateResult.storageAccountName}`,
    );
  }

  if (stateResult.containerCreated) {
    logger.success(`Created Blob Container: ${stateResult.containerName}`);
  } else {
    logger.success(
      `Blob Container already exists: ${stateResult.containerName}`,
    );
  }

  logger.newline();
  logger.complete('Bootstrap complete!');
  logger.info('Azure providers registered and state backend ready.');
  logger.newline();
}
