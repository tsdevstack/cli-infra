import { describe, it, expect, rs } from '@rstest/core';
import { LogPrinter } from './log-printer';
import type { LogEntry } from './types';

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    time: '2026-10-30T12:00:01.123Z',
    source: 'auth-service',
    kind: 'app',
    level: 'info',
    message: 'Started',
    raw: { insertId: 'abc' },
    ...overrides,
  };
}

describe('LogPrinter', () => {
  describe('Standard use cases', () => {
    it('should write one terminal line per entry and count them', () => {
      const write = rs.fn();
      const printer = new LogPrinter({
        json: false,
        raw: false,
        color: false,
        sourceWidth: 12,
        filters: {},
        write,
      });

      printer.print([entry(), entry({ message: 'Ready' })]);

      expect(write).toHaveBeenCalledTimes(1);
      const text = write.mock.calls[0][0] as string;
      expect(text.split('\n')).toEqual([
        '2026-10-30 12:00:01.123  auth-service  app       INFO   Started',
        '2026-10-30 12:00:01.123  auth-service  app       INFO   Ready',
        '',
      ]);
      expect(printer.printed).toBe(2);
    });

    it('should write one JSON object per line, with the provider record when asked', () => {
      const write = rs.fn();
      const printer = new LogPrinter({
        json: true,
        raw: true,
        color: false,
        sourceWidth: 0,
        filters: {},
        write,
      });

      printer.print([entry({ fields: { context: 'Main' } })]);

      const parsed = JSON.parse((write.mock.calls[0][0] as string).trim());
      expect(parsed).toEqual({
        time: '2026-10-30T12:00:01.123Z',
        source: 'auth-service',
        kind: 'app',
        level: 'info',
        message: 'Started',
        fields: { context: 'Main' },
        raw: { insertId: 'abc' },
      });
    });

    it('should leave the provider record out of JSON unless asked', () => {
      const write = rs.fn();
      const printer = new LogPrinter({
        json: true,
        raw: false,
        color: false,
        sourceWidth: 0,
        filters: {},
        write,
      });

      printer.print([entry()]);

      const parsed = JSON.parse((write.mock.calls[0][0] as string).trim());
      expect(parsed.raw).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should skip lines that miss the filters and write nothing when none match', () => {
      const write = rs.fn();
      const printer = new LogPrinter({
        json: false,
        raw: false,
        color: false,
        sourceWidth: 12,
        filters: { level: 'warn' },
        write,
      });

      printer.print([entry(), entry({ level: undefined })]);

      expect(write).not.toHaveBeenCalled();
      expect(printer.printed).toBe(0);
    });
  });
});
