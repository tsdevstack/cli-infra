/**
 * Build the KQL query for a time window: every selected source's legs in
 * one fuzzy union (a table that holds nothing yet does not fail the query),
 * the window, the text search, then the given tail (order, take, count).
 * Returns undefined when no selected source has lines of the requested kind.
 *
 * The text search looks at the whole row (case-insensitive); the printer
 * then keeps only lines with the text in the message or the app's fields.
 */

import type { LogsQuery } from '../../logs/types';
import { buildAzureSourceLegs } from './build-azure-source-legs';
import { escapeKqlString } from './escape-kql-string';

export function buildAzureLogsQuery(
  query: LogsQuery,
  names: { projectName: string; targetEnv: string },
  window: { from: Date; to: Date; includeEnd: boolean },
  tail: string,
): string | undefined {
  const legs = query.sources.flatMap((source) =>
    buildAzureSourceLegs(source, names, {
      kind: query.kind,
      level: query.level,
    }),
  );
  if (legs.length === 0) {
    return undefined;
  }

  const lines = [
    `union isfuzzy=true ${legs.join(',\n  ')}`,
    `| where TimeGenerated >= datetime(${window.from.toISOString()}) and TimeGenerated ${window.includeEnd ? '<=' : '<'} datetime(${window.to.toISOString()})`,
  ];
  if (query.grep) {
    lines.push(
      `| where tostring(Raw) contains "${escapeKqlString(query.grep)}"`,
    );
  }
  lines.push(tail);

  return lines.join('\n');
}
