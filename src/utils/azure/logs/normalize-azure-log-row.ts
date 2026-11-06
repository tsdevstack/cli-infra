/**
 * Turn a Log Analytics row (the columns every leg returns: TimeGenerated,
 * Source, Kind, Level, Text, Raw) into the shared line shape.
 *
 * - App lines: our pino JSON or other JSON in Text; plain text has no level
 * - Platform lines: Text and the platform's level
 * - Edge lines: built from the Front Door row in Raw
 */

import { LOG_KINDS } from '../../../constants';
import { normalizeLogLevel } from '../../logs/normalize-log-level';
import { parseJsonLogPayload } from '../../logs/parse-json-log-payload';
import type { LogEntry, LogKind } from '../../logs/types';
import { formatAzureFrontDoorRow } from './format-azure-front-door-row';

export function normalizeAzureLogRow(row: Record<string, unknown>): LogEntry {
  const generated = row.TimeGenerated;
  const time = new Date(
    generated instanceof Date ? generated : String(generated ?? 0),
  ).toISOString();
  const source = String(row.Source ?? '');
  const kind: LogKind = (LOG_KINDS as readonly string[]).includes(
    String(row.Kind),
  )
    ? (row.Kind as LogKind)
    : 'platform';
  const text = String(row.Text ?? '').replace(/\r?\n$/, '');

  // Dynamic columns can arrive as objects or as JSON text
  let raw: unknown = row.Raw;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      // keep the text
    }
  }

  if (kind === 'edge') {
    const record =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return { time, source, kind, ...formatAzureFrontDoorRow(record), raw };
  }

  if (kind === 'app') {
    if (text.startsWith('{')) {
      try {
        const payload: unknown = JSON.parse(text);
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          return {
            time,
            source,
            kind,
            ...parseJsonLogPayload(payload as Record<string, unknown>),
            raw,
          };
        }
      } catch {
        // Not JSON after all: plain text
      }
    }
    return { time, source, kind, message: text, raw };
  }

  return {
    time,
    source,
    kind,
    level: normalizeLogLevel(row.Level),
    message: text,
    raw,
  };
}
