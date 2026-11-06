/**
 * Validate Tracing Settings
 *
 * tracing.sampleRate is the share of new traces kept in an environment:
 * Kong's rate, which the services follow, and the rate of requests that
 * start in a service (scheduled jobs).
 */

import { getContext } from '../../context';
import { VALID_TRACING_FIELDS } from '../../constants';

/**
 * Validate the tracing object of an environment
 *
 * @param environment - Environment name for error messages
 * @param tracing - Raw tracing value from infrastructure.json
 * @throws CliError on an unknown field or a rate outside 0 to 1
 */
export function validateTracingOverride(
  environment: string,
  tracing: unknown,
): void {
  const { CliError } = getContext();

  if (
    typeof tracing !== 'object' ||
    tracing === null ||
    Array.isArray(tracing)
  ) {
    throw new CliError(
      `"tracing" must be an object (${environment}.tracing)`,
      'Infrastructure Config',
      'Example: "tracing": { "sampleRate": 0.1 }',
    );
  }

  for (const field of Object.keys(tracing)) {
    if (!(VALID_TRACING_FIELDS as readonly string[]).includes(field)) {
      throw new CliError(
        `Unknown field "${field}" in ${environment}.tracing`,
        'Infrastructure Config',
        `Valid fields: ${VALID_TRACING_FIELDS.join(', ')}`,
      );
    }
  }

  const sampleRate: unknown = Reflect.get(tracing, 'sampleRate');
  if (
    sampleRate !== undefined &&
    (typeof sampleRate !== 'number' ||
      !Number.isFinite(sampleRate) ||
      sampleRate < 0 ||
      sampleRate > 1)
  ) {
    throw new CliError(
      `"tracing.sampleRate" must be a number from 0 to 1 (${environment}.tracing.sampleRate)`,
      'Infrastructure Config',
      '1 keeps every trace (the default), 0.1 keeps one request in ten, 0 keeps none.',
    );
  }
}
