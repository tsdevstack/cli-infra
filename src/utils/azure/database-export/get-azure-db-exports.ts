/**
 * The environment's storage of saved databases (Azure)
 */

import path from 'node:path';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import type { AzureCommandContext } from '../commands/types';

export interface AzureDbExports {
  /** The storage account (its key lists the files) */
  storageAccount: string;
  /** The container's URL (db-init's EXPORT_CONTAINER_URL) */
  containerUrl: string;
}

/**
 * Terraform makes the storage account and its container at deploy (outputs
 * db_exports_storage_account, db_exports_container_url). An environment
 * last deployed with an older CLI has none yet. Needs the Terraform folder
 * set up (initTerraformBeforeChanges).
 *
 * @param ctx - The command's context
 * @returns Where the files are, or null when the environment has no storage yet
 */
export function getAzureDbExports(
  ctx: AzureCommandContext,
): AzureDbExports | null {
  const terraformDir = path.join(
    ctx.projectRoot,
    'infrastructure',
    'terraform',
    ctx.targetEnv,
  );
  const tfEnv = buildAzureTerraformEnv(buildRuntime(), ctx.credentials);
  try {
    return {
      storageAccount: getTerraformOutput(
        terraformDir,
        'db_exports_storage_account',
        tfEnv,
      ),
      containerUrl: getTerraformOutput(
        terraformDir,
        'db_exports_container_url',
        tfEnv,
      ),
    };
  } catch {
    return null;
  }
}
