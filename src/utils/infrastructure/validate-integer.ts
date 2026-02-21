/**
 * Validate Integer Field
 *
 * Validates that a value is an integer within a given range.
 */

import { getContext } from '../../context';

/**
 * Validate integer field is within range
 *
 * @param value - Value to validate
 * @param field - Field name for error messages
 * @param context - Context path (e.g., "dev.auth-service")
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @throws CliError if validation fails
 */
export function validateInteger(
  value: unknown,
  field: string,
  context: string,
  min: number,
  max: number
): void {
  const { CliError } = getContext();

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new CliError(
      `${context}.${field}: must be an integer (got ${typeof value})`,
      'Infrastructure Config',
      `Valid range: ${min}-${max}`
    );
  }

  if (value < min || value > max) {
    throw new CliError(
      `${context}.${field}: ${value} is out of range`,
      'Infrastructure Config',
      `Valid range: ${min}-${max}`
    );
  }
}