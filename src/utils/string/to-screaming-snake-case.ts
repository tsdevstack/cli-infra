/**
 * Convert string to SCREAMING_SNAKE_CASE
 *
 * Replaces hyphens with underscores and converts to uppercase.
 * Used for environment variable and secret key naming.
 */

/**
 * Convert string to SCREAMING_SNAKE_CASE
 *
 * @example
 * toScreamingSnakeCase("test-service") // Returns: "TEST_SERVICE"
 * toScreamingSnakeCase("auth-service") // Returns: "AUTH_SERVICE"
 */
export function toScreamingSnakeCase(str: string): string {
  return str.replace(/-/g, '_').toUpperCase();
}
