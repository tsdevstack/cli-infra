/**
 * Convert domain to GCP-safe DNS authorization name
 *
 * GCP resource names allow: lowercase letters, numbers, hyphens only.
 * Dots in domain names must be replaced with hyphens.
 */

/**
 * Generate a GCP-safe DNS authorization name from a domain
 *
 * @example
 * toDnsAuthName("api.example.com") // Returns: "api-example-com"
 */
export function toDnsAuthName(domain: string): string {
  return domain.replace(/\./g, '-');
}
