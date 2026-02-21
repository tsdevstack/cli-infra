/**
 * Extract ${PLACEHOLDER} variable names from a config object
 *
 * Matches ${VAR_NAME} but NOT ${{env "VAR_NAME"}} (Kong runtime syntax)
 */

/**
 * Recursively scans an object and extracts all ${PLACEHOLDER} variable names
 * Excludes Kong's ${{env "..."}} runtime environment variable syntax
 */
export function extractPlaceholders(obj: unknown): string[] {
  const placeholders = new Set<string>();
  // Match ${...} but not ${{...}} (Kong's runtime env var syntax uses double braces)
  const regex = /\$\{(?!\{)([^}]+)\}/g;

  function scan(value: unknown): void {
    if (typeof value === 'string') {
      let match;
      while ((match = regex.exec(value)) !== null) {
        placeholders.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(scan);
    }
  }

  scan(obj);
  return Array.from(placeholders);
}
