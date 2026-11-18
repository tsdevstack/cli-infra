/**
 * Save or restore a service's database with db-init (GCP)
 */

import path from 'node:path';
import { buildGcpTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { runGcpDbInit } from '../run-gcp-db-init';
import type { GCPCommandContext } from '../commands/types';

export interface RunGcpDatabaseJobOptions {
  ctx: GCPCommandContext;
  /** export: save the database to the file; restore: replace it with the file */
  mode: 'export' | 'restore';
  serviceName: string;
  /** The file in the exports bucket ({service}/{time}-{reason}.dump) */
  file: string;
}

/**
 * Runs db-init in its export or restore mode for one service, in the VPC,
 * with the exports bucket and a 1-hour limit
 *
 * @throws CliError with the job's logs when it fails
 */
export async function runGcpDatabaseJob(
  options: RunGcpDatabaseJobOptions,
): Promise<void> {
  const { ctx } = options;
  await runGcpDbInit({
    mode: options.mode,
    exportFile: options.file,
    terraformDir: path.join(
      ctx.projectRoot,
      'infrastructure',
      'terraform',
      ctx.targetEnv,
    ),
    tfEnv: buildGcpTerraformEnv(buildRuntime(), ctx.credentials),
    projectName: ctx.projectName,
    targetEnv: ctx.targetEnv,
    credentials: ctx.credentials,
    serviceNames: [options.serviceName],
  });
}
