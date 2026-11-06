/**
 * Map a level from any source to the shared levels: pino labels and numbers
 * (our NestJS lines), GCP severities, and other common names. Anything else
 * means the line has no level.
 */

import type { LogLevel } from './types';

const LEVEL_NAMES: Record<string, LogLevel> = {
  trace: 'debug',
  debug: 'debug',
  verbose: 'debug',
  info: 'info',
  normal: 'info',
  information: 'info',
  informational: 'info',
  notice: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  alert: 'fatal',
  emergency: 'fatal',
};

export function normalizeLogLevel(value: unknown): LogLevel | undefined {
  // pino's numeric levels: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal
  if (typeof value === 'number') {
    if (value >= 60) return 'fatal';
    if (value >= 50) return 'error';
    if (value >= 40) return 'warn';
    if (value >= 30) return 'info';
    if (value >= 10) return 'debug';
    return undefined;
  }
  if (typeof value === 'string') {
    const name = value.trim().toLowerCase();
    return Object.hasOwn(LEVEL_NAMES, name) ? LEVEL_NAMES[name] : undefined;
  }
  return undefined;
}
