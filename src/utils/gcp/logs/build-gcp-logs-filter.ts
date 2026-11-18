/**
 * Build the Cloud Logging filter for a whole query: the time window, every
 * selected source, and the text search. Returns undefined when no selected
 * source has lines of the requested kind. A query without a window
 * (--follow) or `includeTime: false` gives a filter without one.
 *
 * The text search is Cloud Logging's global restriction, which matches the
 * text in any field. The printer then keeps only lines with the text in the
 * message or the app's fields, like on the other providers.
 */

import type { NamingScheme } from '@tsdevstack/infra-core';
import type { LogsFollowQuery, LogsQuery } from '../../logs/types';
import { buildGcpLogSourceFilter } from './build-gcp-log-source-filter';

export function buildGcpLogsFilter(
  query: LogsFollowQuery & Partial<Pick<LogsQuery, 'since' | 'until'>>,
  projectName: string,
  naming: NamingScheme,
  options: {
    /** Default true */
    includeTime?: boolean;
    /** Storage buckets: the environment and its GCP project (bucket names) */
    environment?: string;
    gcpProjectId?: string;
  } = {},
): string | undefined {
  const sourceFilters = query.sources
    .map((source) =>
      buildGcpLogSourceFilter(source, projectName, naming, {
        kind: query.kind,
        level: query.level,
        environment: options.environment,
        gcpProjectId: options.gcpProjectId,
      }),
    )
    .filter((filter): filter is string => filter !== undefined);

  if (sourceFilters.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  if (options.includeTime !== false && query.since && query.until) {
    parts.push(`timestamp>="${query.since.toISOString()}"`);
    parts.push(`timestamp<="${query.until.toISOString()}"`);
  }
  parts.push(
    sourceFilters.length === 1
      ? sourceFilters[0]
      : `(${sourceFilters.join(' OR ')})`,
  );
  if (query.grep) {
    const escaped = query.grep.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    parts.push(`"${escaped}"`);
  }

  return parts.join(' AND ');
}
