/**
 * Escape a string for use in HCL (Terraform)
 *
 * Escapes backslashes, double quotes, and template interpolation
 * sequences to prevent HCL syntax errors.
 */

export function escapeHcl(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, () => '$${');
}
