/**
 * Pick the sources to read: one by name, or all of them (--all)
 */

import { getContext } from '../../context';
import type { LogSource } from './types';

export function selectLogSources(
  sources: LogSource[],
  name: string | undefined,
): LogSource[] {
  const { CliError } = getContext();

  if (!name) {
    return sources;
  }

  const source = sources.find((candidate) => candidate.name === name);
  if (!source) {
    throw new CliError(
      `Unknown log source: ${name}`,
      'infra:logs',
      `Sources in this project: ${sources.map((s) => s.name).join(', ')}`,
    );
  }

  return [source];
}
