import { describe, it, expect } from '@rstest/core';
import { matchesLogFilters } from './matches-log-filters';
import type { LogEntry } from './types';

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    time: '2026-10-30T12:00:00.000Z',
    source: 'auth-service',
    kind: 'app',
    level: 'info',
    message: 'GET /auth/v1/me 200 12ms',
    fields: { correlationId: 'Abc-123' },
    raw: {},
    ...overrides,
  };
}

describe('matchesLogFilters', () => {
  describe('Standard use cases', () => {
    it('should keep every line when no filter is set', () => {
      expect(matchesLogFilters(entry(), {})).toBe(true);
      expect(matchesLogFilters(entry({ level: undefined }), {})).toBe(true);
    });

    it('should keep the level and above', () => {
      expect(
        matchesLogFilters(entry({ level: 'warn' }), { level: 'warn' }),
      ).toBe(true);
      expect(
        matchesLogFilters(entry({ level: 'fatal' }), { level: 'warn' }),
      ).toBe(true);
      expect(
        matchesLogFilters(entry({ level: 'info' }), { level: 'warn' }),
      ).toBe(false);
    });

    it('should keep only the requested kind', () => {
      expect(matchesLogFilters(entry({ kind: 'edge' }), { kind: 'edge' })).toBe(
        true,
      );
      expect(matchesLogFilters(entry({ kind: 'app' }), { kind: 'edge' })).toBe(
        false,
      );
    });

    it('should find text in the message or the fields, ignoring case', () => {
      expect(matchesLogFilters(entry(), { grep: '/AUTH/v1' })).toBe(true);
      expect(matchesLogFilters(entry(), { grep: 'abc-123' })).toBe(true);
      expect(matchesLogFilters(entry(), { grep: 'offers' })).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should leave out lines without a level when --level is set', () => {
      expect(
        matchesLogFilters(entry({ level: undefined }), { level: 'debug' }),
      ).toBe(false);
    });

    it('should not search the provider record', () => {
      const line = entry({
        fields: undefined,
        raw: { resource: 'offers-service' },
      });
      expect(matchesLogFilters(line, { grep: 'offers' })).toBe(false);
    });

    it('should apply every filter together', () => {
      const line = entry({ level: 'error', message: 'Database timeout' });
      expect(
        matchesLogFilters(line, {
          level: 'warn',
          kind: 'app',
          grep: 'timeout',
        }),
      ).toBe(true);
      expect(
        matchesLogFilters(line, {
          level: 'warn',
          kind: 'platform',
          grep: 'timeout',
        }),
      ).toBe(false);
    });
  });
});
