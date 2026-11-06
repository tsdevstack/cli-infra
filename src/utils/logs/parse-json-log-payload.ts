/**
 * Read a JSON line an app wrote (the same on every provider): our pino
 * lines (msg, level, the app's fields), or another app's JSON (message,
 * level). Without a level of its own, the line takes the provider's, when
 * there is one.
 */

import { PINO_BASE_FIELDS } from '../../constants';
import { normalizeLogLevel } from './normalize-log-level';
import type { LogEntry } from './types';

export function parseJsonLogPayload(
  payload: Record<string, unknown>,
  providerLevel?: unknown,
): Pick<LogEntry, 'level' | 'message' | 'fields'> {
  if (typeof payload.msg === 'string') {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!(PINO_BASE_FIELDS as readonly string[]).includes(key)) {
        fields[key] = value;
      }
    }
    return {
      level: normalizeLogLevel(payload.level),
      message: payload.msg,
      ...(Object.keys(fields).length > 0 && { fields }),
    };
  }

  return {
    level: normalizeLogLevel(payload.level) ?? normalizeLogLevel(providerLevel),
    message:
      typeof payload.message === 'string'
        ? payload.message
        : JSON.stringify(payload),
  };
}
