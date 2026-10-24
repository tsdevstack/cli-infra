/**
 * Validate Redis Memory Size
 *
 * redis.memoryGb sizes Memorystore on GCP. AWS (ElastiCache node type) and
 * Azure (Managed Redis SKU) size Redis by tier, so the field had no effect
 * there and is rejected instead of being silently ignored.
 */

import { getContext } from '../../context';
import { REDIS_CONSTRAINTS } from '../../constants';
import type { SchemaProvider } from './get-provider-schema-config';

/**
 * Validate redis.memoryGb for an environment
 *
 * @param environment - Environment name for error messages
 * @param memoryGb - Raw memoryGb value from infrastructure.json (undefined = not set)
 * @param provider - Cloud provider from config.json
 * @throws CliError if the field is set outside GCP or is out of range on GCP
 */
export function validateRedisMemoryGb(
  environment: string,
  memoryGb: unknown,
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();

  if (memoryGb === undefined) {
    return;
  }

  const field = `${environment}.redis.memoryGb`;

  if (provider !== 'gcp') {
    throw new CliError(
      `"redis.memoryGb" is not supported on ${provider.toUpperCase()} (${field})`,
      'Infrastructure Config',
      `${provider.toUpperCase()} sizes Redis by its tier. Remove "memoryGb" from ${environment}.redis in .tsdevstack/infrastructure.json and choose a "tier" instead.`,
    );
  }

  const { min, max } = REDIS_CONSTRAINTS.memoryGb;
  if (
    typeof memoryGb !== 'number' ||
    !Number.isInteger(memoryGb) ||
    memoryGb < min ||
    memoryGb > max
  ) {
    throw new CliError(
      `"redis.memoryGb" must be a whole number from ${min} to ${max} (${field})`,
      'Infrastructure Config',
      `Set "memoryGb" for ${environment}.redis in .tsdevstack/infrastructure.json (or remove it to use the default).`,
    );
  }
}
