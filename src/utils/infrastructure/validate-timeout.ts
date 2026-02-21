/**
 * Validate Timeout Field
 *
 * Validates timeout format ("Ns" where N is seconds within range).
 */

import { getContext } from '../../context';
import { VALIDATION_CONSTRAINTS } from '../../constants';

/**
 * Validate timeout field format and range
 *
 * @param value - Value to validate
 * @param context - Context path (e.g., "dev.auth-service")
 * @throws CliError if validation fails
 */
export function validateTimeout(value: unknown, context: string): void {
  const { CliError } = getContext();

  if (typeof value !== 'string') {
    throw new CliError(
      `${context}.timeout: must be a string (got ${typeof value})`,
      'Infrastructure Config',
      'Format: "30s" to "3600s"'
    );
  }

  const match = value.match(/^(\d+)s$/);
  if (!match) {
    throw new CliError(
      `${context}.timeout: invalid format "${value}"`,
      'Infrastructure Config',
      'Format: "Ns" where N is seconds (e.g., "300s")'
    );
  }

  const seconds = parseInt(match[1], 10);
  const { minSeconds, maxSeconds } = VALIDATION_CONSTRAINTS.timeout;

  if (seconds < minSeconds || seconds > maxSeconds) {
    throw new CliError(
      `${context}.timeout: ${seconds}s is out of range`,
      'Infrastructure Config',
      `Valid range: ${minSeconds}s to ${maxSeconds}s`
    );
  }
}