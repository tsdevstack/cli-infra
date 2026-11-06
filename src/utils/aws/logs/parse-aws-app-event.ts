/**
 * Turn a container's output line (awslogs driver) into the shared shape:
 * our pino JSON, other JSON, or plain text without a level
 */

import type { FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { parseJsonLogPayload } from '../../logs/parse-json-log-payload';
import type { LogEntry, LogSource } from '../../logs/types';

export function parseAwsAppEvent(
  event: FilteredLogEvent,
  source: LogSource,
): LogEntry {
  const time = new Date(event.timestamp ?? 0).toISOString();
  const text = (event.message ?? '').replace(/\r?\n$/, '');

  if (text.startsWith('{')) {
    try {
      const payload: unknown = JSON.parse(text);
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return {
          time,
          source: source.name,
          kind: 'app',
          ...parseJsonLogPayload(payload as Record<string, unknown>),
          raw: event,
        };
      }
    } catch {
      // Not JSON after all: plain text
    }
  }

  return { time, source: source.name, kind: 'app', message: text, raw: event };
}
