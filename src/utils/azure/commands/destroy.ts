/**
 * Azure Destroy Handler
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { executeTerraform, getTerraformOutput } from '../terraform';
import { revokeKeyVaultSecretRead } from '../key-vault/revoke-key-vault-secret-read';
import { buildKongVaultSecretNames } from '../key-vault/build-kong-vault-secret-names';
import {
  buildAzureTerraformEnv,
  checkTerraformInstalled,
} from '@tsdevstack/infra-core';
import { deleteEnvironmentContainerResources } from '../delete/delete-environment-container-resources';
import { warnHandAddedDnsRecords } from '../dns/warn-hand-added-dns-records';
import type { AzureCommandContext, DestroyOptions } from './types';
import { resolveAzureNaming } from '../naming/resolve-azure-naming';
import { resolvePostgresServerName } from '../resolve-postgres-server-name';
import { liftDatabaseLock } from '../database-lock/lift-database-lock';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';

/**
 * Check if any service in the project has a database
 */
function projectHasDatabase(): boolean {
  const { loadFrameworkConfig } = getContext();
  try {
    const config = loadFrameworkConfig();
    return config.services.some((s) => s.hasDatabase);
  } catch {
    return false;
  }
}

/**
 * Destroy Azure infrastructure
 */
export async function azureDestroy(
  ctx: AzureCommandContext,
  options: DestroyOptions,
): Promise<void> {
  const { logger, CliError, buildKeyVaultName } = getContext();
  const runtime = buildRuntime();

  checkTerraformInstalled(runtime);

  // Before anything is deleted: the check looks for the shared Key Vault
  const naming = await resolveAzureNaming(
    ctx.credentials,
    ctx.projectName,
    ctx.targetEnv,
  );

  const outputDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );

  if (!fs.existsSync(outputDir)) {
    throw new CliError(
      `Configuration directory not found: ${outputDir}`,
      'infra:destroy',
      'Run: npx tsdevstack infra:deploy first to create infrastructure',
    );
  }

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`Location: ${ctx.credentials.location}`);
  logger.newline();

  const hasDatabase = projectHasDatabase();

  // The DNS zone goes too: say what was added to it by hand
  await warnHandAddedDnsRecords({
    credentials: ctx.credentials,
    resourceGroupName: `${ctx.projectName}-${ctx.targetEnv}-rg`,
    projectName: ctx.projectName,
    environment: ctx.targetEnv,
  });

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    logger.warn('This will DESTROY all infrastructure resources!');
    logger.newline();

    if (hasDatabase) {
      logger.warn(
        'This includes the PostgreSQL Flexible Server (ALL databases for ALL services).',
      );
      logger.warn('DATABASE DATA WILL BE PERMANENTLY LOST.');
      logger.newline();
      logger.info('Back up your databases before proceeding:');
      logger.info('  Portal: PostgreSQL Flexible Server → Backups');
      logger.info('  Or use pg_dump for individual databases.');
      logger.newline();
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to destroy the ${ctx.targetEnv} environment?`,
        default: false,
      },
    ]);

    if (!confirm) {
      logger.info('Destroy cancelled by user');
      return;
    }
  }

  // First, before anything is deleted: the database's delete lock. Azure
  // refuses to delete a locked server and its resource group, so a teardown
  // that can't lift it stops here with everything still in place. A rerun
  // after a later failure finds no lock and goes on.
  const serverName = resolvePostgresServerName(
    ctx.projectName,
    ctx.targetEnv,
    loadInfrastructureConfig(),
    naming,
  ).name;
  logger.info(
    `Lifting the delete lock on the database server ${serverName}...`,
  );
  try {
    const lifted = await liftDatabaseLock({
      credentials: ctx.credentials,
      resourceGroupName: `${ctx.projectName}-${ctx.targetEnv}-rg`,
      serverName,
    });
    logger.success(lifted ? '  Lifted' : '  No lock on it');
  } catch (error) {
    throw new CliError(
      `Could not lift the delete lock on the database server ${serverName}: ${error instanceof Error ? error.message : String(error)}`,
      'infra:destroy',
      'Nothing was deleted. Locks need the User Access Administrator role on the resource group (Azure account setup, step 5). Or delete the lock in the portal (the server > Locks), then run infra:destroy again.',
    );
  }
  logger.newline();

  // Container Apps and migration jobs come from deploys (SDK), not Terraform,
  // and Azure will not delete their managed environment while they exist
  logger.info(
    'Removing Container Apps and migration jobs created by deploys...',
  );
  const containerResources = await deleteEnvironmentContainerResources({
    credentials: ctx.credentials,
    resourceGroupName: `${ctx.projectName}-${ctx.targetEnv}-rg`,
    environmentName: `${ctx.projectName}-${ctx.targetEnv}-cae`,
  });
  for (const name of containerResources.deleted) {
    logger.success(`  Deleted ${name}`);
  }
  if (containerResources.failed.length > 0) {
    throw new CliError(
      `Could not delete ${containerResources.failed.map((f) => f.name).join(', ')}`,
      'infra:destroy',
      `${containerResources.failed.map((f) => `${f.name}: ${f.error}`).join('; ')}. Terraform cannot delete the Container Apps environment while they exist; run infra:destroy again.`,
    );
  }
  logger.newline();

  // Build Terraform environment
  const tfEnv = buildAzureTerraformEnv(runtime, ctx.credentials);

  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
    reconfigure: true,
  });

  if (!initResult.success) {
    throw new CliError(
      'Initialization failed',
      'infra:destroy',
      initResult.error || 'Check the output above for details',
    );
  }

  // Kong's per-secret grants come from deploys, not Terraform. Remove them
  // while Kong's identity exists: Azure keeps an assignment whose identity
  // is deleted, as an unknown identity.
  let kongPrincipalId: string | null = null;
  try {
    kongPrincipalId = getTerraformOutput(outputDir, 'kong_principal_id', tfEnv);
  } catch {
    // No Kong in this state, or a state from before the output existed
  }
  if (kongPrincipalId) {
    logger.newline();
    logger.info("Removing Kong's access to its secrets...");
    try {
      await revokeKeyVaultSecretRead({
        credentials: ctx.credentials,
        resourceGroupName: `${ctx.projectName}-${ctx.targetEnv}-rg`,
        keyVaultName: buildKeyVaultName(ctx.projectName, ctx.targetEnv, naming),
        secretNames: buildKongVaultSecretNames(ctx.projectName).map(
          ({ secretName }) => secretName,
        ),
        principalId: kongPrincipalId,
      });
      logger.success("  Removed Kong's access to its secrets");
    } catch (error) {
      // A grant left behind must not block the teardown
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  logger.newline();
  logger.info('Destroying resources...');
  logger.newline();

  const destroyResult = await executeTerraform('destroy', {
    workDir: outputDir,
    autoApprove: true,
    env: tfEnv,
  });

  if (!destroyResult.success) {
    throw new CliError(
      'Destroy failed',
      'infra:destroy',
      destroyResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.success('Infrastructure destroyed successfully!');
  logger.newline();

  // Post-destroy recovery hints
  if (hasDatabase) {
    logger.info('Data recovery:');
    logger.info(
      '  Backups retained for the configured retention period (7-35 days).',
    );
    logger.info('  Portal: PostgreSQL Flexible Server → Deleted servers');
    logger.newline();
  }
}
