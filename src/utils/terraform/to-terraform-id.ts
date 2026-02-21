/**
 * Convert service name to valid Terraform identifier
 */

/**
 * Convert service name to valid Terraform identifier
 * Replaces hyphens with underscores
 */
export function toTerraformId(name: string): string {
  return name.replace(/-/g, '_');
}
