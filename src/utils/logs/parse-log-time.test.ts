import { describe, it, expect, rs } from '@rstest/core';

class MockCliError extends Error {
  constructor(
    message: string,
    public context?: string,
    public hint?: string,
  ) {
    super(message);
  }
}
rs.mock('../../context', () => ({
  getContext: () => ({ CliError: MockCliError }),
}));

import { parseLogTime } from './parse-log-time';

const NOW = new Date('2026-10-30T12:00:00.000Z');

describe('parseLogTime', () => {
  describe('Standard use cases', () => {
    it('should read minutes, hours and days back from now', () => {
      expect(parseLogTime('30m', NOW).toISOString()).toBe(
        '2026-10-30T11:30:00.000Z',
      );
      expect(parseLogTime('1h', NOW).toISOString()).toBe(
        '2026-10-30T11:00:00.000Z',
      );
      expect(parseLogTime('2d', NOW).toISOString()).toBe(
        '2026-10-28T12:00:00.000Z',
      );
      expect(parseLogTime('45s', NOW).toISOString()).toBe(
        '2026-10-30T11:59:15.000Z',
      );
    });

    it('should read a timestamp with a time zone as given', () => {
      expect(parseLogTime('2026-10-30T10:00:00+02:00', NOW).toISOString()).toBe(
        '2026-10-30T08:00:00.000Z',
      );
      expect(parseLogTime('2026-10-30T10:00:00Z', NOW).toISOString()).toBe(
        '2026-10-30T10:00:00.000Z',
      );
    });

    it('should read a timestamp without a time zone as UTC', () => {
      expect(parseLogTime('2026-10-30T10:00', NOW).toISOString()).toBe(
        '2026-10-30T10:00:00.000Z',
      );
      expect(parseLogTime('2026-10-30 10:00', NOW).toISOString()).toBe(
        '2026-10-30T10:00:00.000Z',
      );
      expect(parseLogTime('2026-10-30', NOW).toISOString()).toBe(
        '2026-10-30T00:00:00.000Z',
      );
    });
  });

  describe('Edge cases', () => {
    it('should reject text that is neither a duration nor a time', () => {
      expect(() => parseLogTime('yesterday', NOW)).toThrow(
        'Invalid time: yesterday',
      );
      expect(() => parseLogTime('1w', NOW)).toThrow('Invalid time: 1w');
    });

    it('should ignore surrounding spaces', () => {
      expect(parseLogTime(' 1h ', NOW).toISOString()).toBe(
        '2026-10-30T11:00:00.000Z',
      );
    });
  });
});
