/**
 * Drop a removed service's database and its roles (Azure remove-service)
 */

import path from 'node:path';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import { runAzureDbInit } from '../run-azure-db-init';
import { getTerraformOutput } from '../terraform';
import type { AzureCommandContext } from '../commands/types';
import type { DeletionStepResult } from '../remove-service/types';

export interface DropDatabaseRolesOptions {
  ctx: AzureCommandContext;
  serviceName: string;
}

/**
 * Runs db-init in its remove mode for the service: it drops the database,
 * then the owner and the app role, which exist only in SQL. Run before the
 * API's database delete. An environment infra:deploy has not converted yet
 * has no db-init (its services use the server admin): skipped, and the API
 * deletes the database.
 */
export async function dropDatabaseRoles(
  options: DropDatabaseRolesOptions,
): Promise<DeletionStepResult> {
  const { ctx, serviceName } = options;
  const { resolveKeyVaultName, AZURE_DB_JOBS_KEY_VAULT_SCOPE } = getContext();
  const terraformDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );
  const tfEnv = buildAzureTerraformEnv(buildRuntime(), ctx.credentials);

  try {
    getTerraformOutput(terraformDir, 'db_jobs_identity_id', tfEnv);
  } catch {
    return {
      success: true,
      deleted: false,
      error: 'Skipped: no db-init in this environment yet (no app role)',
    };
  }

  try {
    await runAzureDbInit({
      mode: 'remove',
      terraformDir,
      tfEnv,
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials,
      serviceNames: [serviceName],
      dbJobsKeyVault: await resolveKeyVaultName(
        ctx.credentials,
        ctx.projectName,
        ctx.targetEnv,
        AZURE_DB_JOBS_KEY_VAULT_SCOPE,
      ),
      serviceKeyVaults: {},
    });
    return { success: true, deleted: true };
  } catch (error) {
    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
