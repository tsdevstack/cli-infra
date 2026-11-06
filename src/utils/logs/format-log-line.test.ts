import { describe, it, expect } from '@rstest/core';
import { formatLogLine } from './format-log-line';
import type { LogEntry } from './types';

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    time: '2026-10-30T12:00:01.123Z',
    source: 'auth-service',
    kind: 'app',
    level: 'info',
    message: 'GET /auth/v1/me 200 12ms',
    raw: {},
    ...overrides,
  };
}

describe('formatLogLine', () => {
  describe('Standard use cases', () => {
    it('should show time, source, kind, level and message', () => {
      expect(formatLogLine(entry(), 14, false)).toBe(
        '2026-10-30 12:00:01.123  auth-service    app       INFO   GET /auth/v1/me 200 12ms',
      );
    });

    it('should add the context, the error and the correlation ID', () => {
      const line = formatLogLine(
        entry({
          level: 'error',
          message: 'Login failed',
          fields: {
            context: 'AuthService',
            error: {
              name: 'QueryFailedError',
              message: 'timeout',
              stack: 'at x',
            },
            correlationId: 'req-1',
          },
        }),
        12,
        false,
      );
      expect(line).toBe(
        '2026-10-30 12:00:01.123  auth-service  app       ERROR  [AuthService] Login failed (QueryFailedError: timeout) correlationId=req-1',
      );
    });

    it('should show a dash for lines without a level', () => {
      const line = formatLogLine(
        entry({
          source: 'kong',
          level: undefined,
          message: '10.0.0.1 - - "GET / HTTP/1.1" 200',
        }),
        4,
        false,
      );
      expect(line).toBe(
        '2026-10-30 12:00:01.123  kong  app       -      10.0.0.1 - - "GET / HTTP/1.1" 200',
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep each entry on one line', () => {
      const line = formatLogLine(
        entry({ message: 'Error: boom\n    at main' }),
        12,
        false,
      );
      expect(line).toContain('Error: boom ⏎     at main');
      expect(line).not.toContain('\n');
    });

    it('should color the level and dim the time on a terminal', () => {
      const line = formatLogLine(entry({ level: 'error' }), 12, true);
      expect(line).toContain('\u001b[31mERROR\u001b[0m');
      expect(line.startsWith('\u001b[2m2026-10-30 12:00:01.123\u001b[0m')).toBe(
        true,
      );
    });

    it('should not fail on an error field without a message', () => {
      const line = formatLogLine(
        entry({ fields: { error: 'plain text' } }),
        12,
        false,
      );
      expect(line).toContain('GET /auth/v1/me 200 12ms');
    });
  });
});
