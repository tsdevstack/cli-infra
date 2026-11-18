/**
 * Set up each database service's owner and app role (Azure infra:deploy)
 */

import path from 'node:path';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';
import { buildAndPushAzureDbInit } from './build-and-push-azure-db-init';
import { writeKeyVaultSecret } from './key-vault/write-key-vault-secret';
import { runAzureDbInit } from './run-azure-db-init';
import { getTerraformOutput } from './terraform';

export interface SetUpAzureDatabaseUsersOptions {
  /** The environment's Terraform folder (outputs, the generated db-init/) */
  terraformDir: string;
  tfEnv: Record<string, string>;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  /** Services with a database */
  serviceNames: readonly string[];
  /** The database jobs' Key Vault */
  dbJobsKeyVault: string;
  /** Each database service's own Key Vault, by service name */
  serviceKeyVaults: Record<string, string>;
}

/**
 * After Terraform:
 * 1. The server admin's password (a Terraform output) into the database
 *    jobs' vault, where only db-init and the deploy read it
 * 2. db-init built, pushed and run in the Container Apps environment: it
 *    creates the owner and the app role, moves the tables the admin owns to
 *    the owner, writes MIGRATION_DATABASE_URL (database jobs' vault) and
 *    DATABASE_URL (the service's vault)
 *
 * @throws CliError when a step fails
 */
export async function setUpAzureDatabaseUsers(
  options: SetUpAzureDatabaseUsersOptions,
): Promise<void> {
  const { logger, AZURE_DB_ADMIN_PASSWORD_SECRET } = getContext();
  const output = (name: string): string =>
    getTerraformOutput(options.terraformDir, name, options.tfEnv);

  logger.info('Setting up database users...');
  await writeKeyVaultSecret({
    credentials: options.credentials,
    vaultName: options.dbJobsKeyVault,
    secretName: AZURE_DB_ADMIN_PASSWORD_SECRET,
    value: output('database_admin_password'),
  });

  await buildAndPushAzureDbInit({
    dbInitDir: path.join(options.terraformDir, 'db-init'),
    acrLoginServer: output('acr_login_server'),
    credentials: options.credentials,
  });

  await runAzureDbInit({
    mode: 'init',
    terraformDir: options.terraformDir,
    tfEnv: options.tfEnv,
    projectName: options.projectName,
    targetEnv: options.targetEnv,
    credentials: options.credentials,
    serviceNames: options.serviceNames,
    dbJobsKeyVault: options.dbJobsKeyVault,
    serviceKeyVaults: options.serviceKeyVaults,
  });
}
