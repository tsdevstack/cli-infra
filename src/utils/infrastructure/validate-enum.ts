/**
 * Validate Enum Field
 *
 * Validates that a value is a string matching one of the allowed values.
 */

import { getContext } from '../../context';

/**
 * Validate enum field matches allowed values
 *
 * @param value - Value to validate
 * @param field - Field name for error messages
 * @param context - Context path (e.g., "dev.auth-service")
 * @param validValues - Array of valid values
 * @throws CliError if validation fails
 */
export function validateEnum(
  value: unknown,
  field: string,
  context: string,
  validValues: readonly string[]
): void {
  const { CliError } = getContext();

  if (typeof value !== 'string') {
    throw new CliError(
      `${context}.${field}: must be a string (got ${typeof value})`,
      'Infrastructure Config',
      `Valid values: ${validValues.join(', ')}`
    );
  }

  if (!validValues.includes(value)) {
    throw new CliError(
      `${context}.${field}: invalid value "${value}"`,
      'Infrastructure Config',
      `Valid values: ${validValues.join(', ')}`
    );
  }
}