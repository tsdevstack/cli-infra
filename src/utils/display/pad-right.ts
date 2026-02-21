/**
 * Pad string to specified length
 *
 * Used for tabular output formatting in CLI commands.
 */

/**
 * Pad string to the right with spaces
 */
export function padRight(str: string, length: number): string {
  return str.padEnd(length);
}
