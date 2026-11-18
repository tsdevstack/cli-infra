/**
 * The environment's bucket of saved databases (AWS)
 */

import path from 'node:path';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import type { AWSCommandContext } from '../commands/types';

/**
 * Terraform makes the bucket at deploy (output db_exports_bucket). An
 * environment last deployed with an older CLI has none yet. Needs the
 * Terraform folder set up (initTerraformBeforeChanges).
 *
 * @param ctx - The command's context
 * @returns The bucket's name, or null when the environment has none yet
 */
export function getAwsDbExportsBucket(ctx: AWSCommandContext): string | null {
  try {
    return getTerraformOutput(
      path.join(ctx.projectRoot, 'infrastructure', 'terraform', ctx.targetEnv),
      'db_exports_bucket',
      buildAwsTerraformEnv(buildRuntime(), ctx.credentials),
    );
  } catch {
    return null;
  }
}
