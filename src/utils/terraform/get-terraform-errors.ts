/**
 * Get Terraform Errors
 *
 * Splits Terraform's output into its error blocks. Terraform prints each
 * error as "Error: ..." inside a box drawn with "│" (or plainly with
 * -no-color), so a failed run with three errors gives three entries.
 */

/**
 * The text of every error in Terraform's output
 *
 * @param output - Terraform's combined output
 * @returns One entry per error, without the leading "Error: "
 */
export function getTerraformErrors(output: string): string[] {
  return output.split(/^[│\s]*Error: /m).slice(1);
}
