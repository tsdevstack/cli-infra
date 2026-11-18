/**
 * Turn a line of a Container Apps console log stream (output=json:
 * `{"TimeStamp": "...", "Log": "..."}`) into a line, through the same code
 * as the Log Analytics rows (normalizeAzureLogRow), so live and read lines
 * look the same. Undefined for the stream's own connection notes.
 *
 * - A leading container runtime flag ("F " for a full line, "P " for part
 *   of one) is dropped when the stream passes it on.
 * - A line that isn't JSON is taken as the text itself, timed `now`.
 */

import type { LogEntry, LogSource } from '../../logs/types';
import { normalizeAzureLogRow } from './normalize-azure-log-row';
import { parseAzureStreamTime } from './parse-azure-stream-time';

/** The stream's own notes when it connects, not the app's output */
const CONNECTION_NOTES =
  /^(connecting to the container|successfully connected to container)/i;

export function parseAzureConsoleStreamLine(
  line: string,
  source: LogSource,
  now: Date,
): LogEntry | undefined {
  let record: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      record = parsed as Record<string, unknown>;
    }
  } catch {
    record = undefined;
  }

  const rawText = record ? record.Log : line;
  const text = (typeof rawText === 'string' ? rawText : '')
    .replace(/^[FP] /, '')
    .trim();
  if (text === '' || CONNECTION_NOTES.test(text)) {
    return undefined;
  }

  return normalizeAzureLogRow({
    TimeGenerated: parseAzureStreamTime(record?.TimeStamp, now),
    Source: source.name,
    Kind: 'app',
    Text: text,
    Raw: record ?? line,
  });
}
