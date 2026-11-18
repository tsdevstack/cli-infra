/**
 * Save or restore a service's database with db-init (Azure)
 */

import path from 'node:path';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { runAzureDbInit } from '../run-azure-db-init';
import type { AzureCommandContext } from '../commands/types';

export interface RunAzureDatabaseJobOptions {
  ctx: AzureCommandContext;
  /** export: save the database to the file; restore: replace it with the file */
  mode: 'export' | 'restore';
  serviceName: string;
  /** The file in the exports container ({service}/{time}-{reason}.dump) */
  file: string;
}

/**
 * Runs db-init in its export or restore mode for one service, in the
 * Container Apps environment, with the exports container and a 1-hour
 * limit. It writes no secret, so it gets no service vault.
 *
 * @throws CliError when the job fails
 */
export async function runAzureDatabaseJob(
  options: RunAzureDatabaseJobOptions,
): Promise<void> {
  const { resolveKeyVaultName, AZURE_DB_JOBS_KEY_VAULT_SCOPE } = getContext();
  const { ctx } = options;
  await runAzureDbInit({
    mode: options.mode,
    exportFile: options.file,
    terraformDir: path.join(
      ctx.projectRoot,
      'infrastructure',
      'terraform',
      ctx.targetEnv,
    ),
    tfEnv: buildAzureTerraformEnv(buildRuntime(), ctx.credentials),
    projectName: ctx.projectName,
    targetEnv: ctx.targetEnv,
    credentials: ctx.credentials,
    serviceNames: [options.serviceName],
    dbJobsKeyVault: await resolveKeyVaultName(
      ctx.credentials,
      ctx.projectName,
      ctx.targetEnv,
      AZURE_DB_JOBS_KEY_VAULT_SCOPE,
    ),
    serviceKeyVaults: {},
  });
}
