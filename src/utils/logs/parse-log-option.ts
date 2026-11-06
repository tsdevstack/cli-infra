/**
 * Check an infra:logs option against its allowed values (--level, --kind)
 */

import { getContext } from '../../context';

export function parseLogOption<T extends string>(
  option: string,
  value: string,
  allowed: readonly T[],
): T {
  const { CliError } = getContext();
  const normalized = value.trim().toLowerCase();

  const match = allowed.find((candidate) => candidate === normalized);
  if (!match) {
    throw new CliError(
      `Invalid ${option}: ${value}`,
      'infra:logs',
      `Use one of: ${allowed.join(', ')}`,
    );
  }

  return match;
}
