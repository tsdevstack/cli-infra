/**
 * Run the db-init Container Apps job (Azure)
 */

import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { DB_EXPORT_JOB_TIMEOUT_SECONDS } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import {
  AZURE_DATABASE_ADMIN_LOGIN,
  AZURE_DB_INIT_JOB_NAME,
  AZURE_REPEATABLE_JOB_RETRIES,
} from '../../constants';
import { executeContainerJob } from './commands/execute-container-job';
import { getTerraformOutput } from './terraform';

export interface RunAzureDbInitOptions {
  /**
   * init: set up the roles and both URLs; remove: drop the database and the
   * roles; export: save the database to exportFile; restore: replace the
   * database with exportFile
   */
  mode: 'init' | 'remove' | 'export' | 'restore';
  /** The environment's Terraform folder (for its outputs) */
  terraformDir: string;
  tfEnv: Record<string, string>;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  /** Services to set up or whose roles to drop (export, restore: one) */
  serviceNames: readonly string[];
  /** The database jobs' Key Vault (admin password, MIGRATION_DATABASE_URL) */
  dbJobsKeyVault: string;
  /** Each service's own Key Vault (DATABASE_URL), by service name */
  serviceKeyVaults: Record<string, string>;
  /** export and restore: the file in the saved databases' container */
  exportFile?: string;
}

/**
 * Runs db-init (the image infra:deploy pushed) in the Container Apps
 * environment as the database jobs' identity: it reads the server admin's
 * password from the database jobs' vault and sets up each service's owner
 * and app role, drops them with the database, or saves or restores a
 * service's database (the saved databases' container, with a 1-hour
 * limit). No password is in the job's settings.
 *
 * @throws CliError when the job fails (the job's output is in Log Analytics)
 */
export async function runAzureDbInit(
  options: RunAzureDbInitOptions,
): Promise<void> {
  const { logger, CliError, AZURE_DB_ADMIN_PASSWORD_SECRET } = getContext();
  const { terraformDir, tfEnv } = options;
  const output = (name: string): string =>
    getTerraformOutput(terraformDir, name, tfEnv);

  const acrLoginServer = output('acr_login_server');
  logger.info(
    `Running db-init (${options.mode}) for ${options.serviceNames.join(', ')}...`,
  );
  const result = await executeContainerJob({
    credentials: options.credentials,
    resourceGroupName: output('resource_group_name'),
    containerAppsEnvId: output('container_apps_env_id'),
    jobName: AZURE_DB_INIT_JOB_NAME,
    image: `${acrLoginServer}/db-init:latest`,
    command: ['node', 'index.js'],
    envVars: Object.entries({
      MODE: options.mode,
      PROJECT: options.projectName,
      ENVIRONMENT: options.targetEnv,
      DB_HOST: output('database_host'),
      DB_ADMIN_USER: AZURE_DATABASE_ADMIN_LOGIN,
      DB_JOBS_KEY_VAULT: options.dbJobsKeyVault,
      DB_ADMIN_PASSWORD_SECRET: AZURE_DB_ADMIN_PASSWORD_SECRET,
      KEY_VAULTS: JSON.stringify(options.serviceKeyVaults),
      SERVICES: JSON.stringify(options.serviceNames),
      // The job's code signs in as this identity (the only one it carries)
      AZURE_CLIENT_ID: output('db_jobs_identity_client_id'),
      ...(options.exportFile && {
        EXPORT_FILE: options.exportFile,
        EXPORT_CONTAINER_URL: output('db_exports_container_url'),
      }),
    }).map(([name, value]) => ({ name, value })),
    acrLoginServer,
    acrManagedIdentityId: output('db_jobs_identity_id'),
    cpu: 0.5,
    memory: '1Gi',
    // db-init waits up to 5 minutes for its new Key Vault roles to apply;
    // saving or restoring a large database takes longer
    timeoutSeconds: options.exportFile ? DB_EXPORT_JOB_TIMEOUT_SECONDS : 900,
    // init is safe twice at once (it only adds what is missing); restore,
    // remove and export must never run twice
    retries: options.mode === 'init' ? AZURE_REPEATABLE_JOB_RETRIES : 0,
  });

  if (!result.success) {
    throw new CliError(
      `db-init (${options.mode}) failed: ${result.error || 'unknown error'}`,
      'Database users',
      `The job's output is in the environment's Log Analytics workspace: ContainerAppConsoleLogs where JobName starts with "${AZURE_DB_INIT_JOB_NAME}-".`,
    );
  }
  logger.success(`db-init (${options.mode}) completed`);
}
