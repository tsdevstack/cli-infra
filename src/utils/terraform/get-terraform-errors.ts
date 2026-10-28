/**
 * Get Terraform Errors
 *
 * Splits Terraform's output into its error blocks. Terraform prints each
 * error as "Error: ..." inside a box drawn with "│" (or plainly with
 * -no-color), so a failed run with three errors gives three entries. The
 * output is colored unless -no-color is set, so the color codes are removed
 * first: they sit between the box and "Error: ".
 */

import { stripVTControlCharacters } from 'node:util';

/**
 * The text of every error in Terraform's output
 *
 * @param output - Terraform's combined output
 * @returns One entry per error, without the leading "Error: "
 */
export function getTerraformErrors(output: string): string[] {
  return stripVTControlCharacters(output)
    .split(/^[│\s]*Error: /m)
    .slice(1);
}
