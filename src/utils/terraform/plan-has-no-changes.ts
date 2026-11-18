/**
 * Plan Has No Changes
 *
 * Terraform ends a plan that would change nothing with "No changes. Your
 * infrastructure matches the configuration." The output is colored unless
 * -no-color is set, so the color codes are removed first: they sit around
 * "No changes.".
 */

import { stripVTControlCharacters } from 'node:util';

/**
 * Whether a plan's output says it would change nothing
 *
 * @param output - Terraform's combined plan output
 * @returns true when the plan has nothing to apply
 */
export function planHasNoChanges(output: string): boolean {
  return /^\s*No changes\./m.test(stripVTControlCharacters(output));
}
