/**
 * The environment's bucket of saved databases (GCP)
 */

import path from 'node:path';
import { buildGcpTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import type { GCPCommandContext } from '../commands/types';

/**
 * Terraform makes the bucket at deploy (output db_exports_bucket). An
 * environment last deployed with an older CLI has none yet. Needs the
 * Terraform folder set up (initTerraformBeforeChanges).
 *
 * @param ctx - The command's context
 * @returns The bucket's name, or null when the environment has none yet
 */
export function getGcpDbExportsBucket(ctx: GCPCommandContext): string | null {
  try {
    return getTerraformOutput(
      path.join(ctx.projectRoot, 'infrastructure', 'terraform', ctx.targetEnv),
      'db_exports_bucket',
      buildGcpTerraformEnv(buildRuntime(), ctx.credentials),
    );
  } catch {
    return null;
  }
}
