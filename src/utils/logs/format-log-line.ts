/**
 * Format one line for the terminal: time (UTC), source, kind, level, then
 * the message. The app's context, error and correlation ID join the message;
 * every other field is in --json.
 */

import { LOG_COLORS } from '../../constants';
import type { LogEntry } from './types';

const KIND_WIDTH = 8;
const LEVEL_WIDTH = 5;

export function formatLogLine(
  entry: LogEntry,
  sourceWidth: number,
  color: boolean,
): string {
  const paint = (code: string, text: string): string =>
    color ? `${code}${text}${LOG_COLORS.reset}` : text;

  const time = entry.time.replace('T', ' ').replace(/Z$/, '');

  const levelText = (entry.level ?? '-').toUpperCase().padEnd(LEVEL_WIDTH);
  let level = levelText;
  if (entry.level === 'error' || entry.level === 'fatal') {
    level = paint(LOG_COLORS.red, levelText);
  } else if (entry.level === 'warn') {
    level = paint(LOG_COLORS.yellow, levelText);
  } else if (entry.level === 'debug') {
    level = paint(LOG_COLORS.dim, levelText);
  }

  const fields = entry.fields ?? {};
  let message = entry.message;
  if (typeof fields.context === 'string') {
    message = `[${fields.context}] ${message}`;
  }
  const error = fields.error;
  if (error && typeof error === 'object') {
    const { name, message: errorMessage } = error as Record<string, unknown>;
    if (typeof errorMessage === 'string') {
      message +=
        typeof name === 'string'
          ? ` (${name}: ${errorMessage})`
          : ` (${errorMessage})`;
    }
  }
  if (typeof fields.correlationId === 'string') {
    message += ` correlationId=${fields.correlationId}`;
  }

  // One line per entry: line breaks inside a message are shown as ⏎
  message = message.replace(/\r?\n/g, ' ⏎ ');

  return [
    paint(LOG_COLORS.dim, time),
    entry.source.padEnd(sourceWidth),
    entry.kind.padEnd(KIND_WIDTH),
    level,
    message,
  ].join('  ');
}
