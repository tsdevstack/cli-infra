/**
 * Check one line against the filters (--level, --kind, --grep). Readers
 * filter on the provider's side where they can; this check makes every
 * provider show exactly the same lines.
 */

import { LOG_LEVELS } from '../../constants';
import type { LogEntry, LogsQuery } from './types';

export function matchesLogFilters(
  entry: LogEntry,
  query: Pick<LogsQuery, 'level' | 'kind' | 'grep'>,
): boolean {
  if (query.kind && entry.kind !== query.kind) {
    return false;
  }

  if (query.level) {
    // Lines without a level are left out (the command says so once)
    if (!entry.level) {
      return false;
    }
    if (LOG_LEVELS.indexOf(entry.level) < LOG_LEVELS.indexOf(query.level)) {
      return false;
    }
  }

  if (query.grep) {
    const needle = query.grep.toLowerCase();
    const haystack = entry.fields
      ? `${entry.message} ${JSON.stringify(entry.fields)}`
      : entry.message;
    if (!haystack.toLowerCase().includes(needle)) {
      return false;
    }
  }

  return true;
}
