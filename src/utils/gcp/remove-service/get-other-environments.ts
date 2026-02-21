/**
 * Get Other Environments
 *
 * Get other environments that may have the service deployed.
 */

import { getContext } from '../../../context';
import type { GCPCommandContext } from '../commands/types';

/**
 * Get other environments that may have the service deployed
 *
 * @param ctx - Infrastructure command context
 * @returns Array of environment names (excluding current environment)
 */
export function getOtherEnvironments(ctx: GCPCommandContext): string[] {
  const { getAvailableEnvironments, findProjectRoot } = getContext();
  const projectRoot = findProjectRoot();

  try {
    const allEnvs = getAvailableEnvironments(projectRoot, 'gcp');
    return allEnvs.filter((env) => env !== ctx.targetEnv);
  } catch {
    // Ignore errors, just return empty array
    return [];
  }
}
