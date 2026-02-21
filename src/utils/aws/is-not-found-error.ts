/**
 * Is Not Found Error
 *
 * Checks if an AWS SDK error is a "not found" type error.
 */

/**
 * Check if error is a "not found" type error
 */
export function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name: string }).name;
    return (
      name === 'NotFound' ||
      name === 'ResourceNotFoundException' ||
      name === 'NoSuchBucket'
    );
  }
  return false;
}
