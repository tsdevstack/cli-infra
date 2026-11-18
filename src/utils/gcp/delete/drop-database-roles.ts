/**
 * Drop a removed service's database and its roles (GCP remove-service)
 */

import path from 'node:path';
import { buildGcpTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { runGcpDbInit } from '../run-gcp-db-init';
import { getTerraformOutput } from '../terraform';
import type { GCPCommandContext } from '../commands/types';
import type { DeletionStepResult } from '../remove-service/types';

export interface DropDatabaseRolesOptions {
  ctx: GCPCommandContext;
  serviceName: string;
}

/**
 * Runs db-init in its remove mode for the service: it drops the database,
 * then the owner and the app role, in SQL. Cloud SQL's API refuses to
 * delete a database owned by a role outside its admin group, which
 * db-init's owner is. Run before the API's database and user deletes. An
 * environment infra:deploy has not converted yet has no db-init (and no
 * app role): skipped, and the API deletes the database and the user.
 */
export async function dropDatabaseRoles(
  options: DropDatabaseRolesOptions,
): Promise<DeletionStepResult> {
  const { ctx, serviceName } = options;
  const terraformDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );
  const tfEnv = buildGcpTerraformEnv(buildRuntime(), ctx.credentials);

  try {
    getTerraformOutput(terraformDir, 'db_jobs_service_account_email', tfEnv);
  } catch {
    return {
      success: true,
      deleted: false,
      error: 'Skipped: no db-init in this environment yet (no app role)',
    };
  }

  try {
    await runGcpDbInit({
      mode: 'remove',
      terraformDir,
      tfEnv,
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials,
      serviceNames: [serviceName],
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
