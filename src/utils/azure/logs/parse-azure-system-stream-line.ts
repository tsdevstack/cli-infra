/**
 * Turn a line of a Container App's system event stream (JSON, the fields
 * of the ContainerAppSystemLogs table: TimeStamp, Type, Reason, Msg, ...)
 * into a platform line, like a read shows it: "Reason: message", the level
 * from Type (Normal, Warning). Undefined for the stream's own connection
 * notes and lines that aren't JSON.
 */

import type { LogEntry, LogSource } from '../../logs/types';
import { normalizeAzureLogRow } from './normalize-azure-log-row';
import { parseAzureStreamTime } from './parse-azure-stream-time';

/** The stream's own notes when it connects, not the app's events */
const CONNECTION_NOTES =
  /^(connecting to the events collector|successfully connected to events server)/i;

export function parseAzureSystemStreamLine(
  line: string,
  source: LogSource,
  now: Date,
): LogEntry | undefined {
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    record = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const text = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  const message = text(record.Msg) || text(record.Log) || text(record.Message);
  if (message === '' || CONNECTION_NOTES.test(message)) {
    return undefined;
  }
  const reason = text(record.Reason);

  return normalizeAzureLogRow({
    TimeGenerated: parseAzureStreamTime(record.TimeStamp, now),
    Source: source.name,
    Kind: 'platform',
    Level: text(record.Type),
    Text: reason ? `${reason}: ${message}` : message,
    Raw: record,
  });
}
