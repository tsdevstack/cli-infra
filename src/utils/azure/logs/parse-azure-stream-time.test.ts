import { describe, it, expect } from '@rstest/core';
import { parseAzureStreamTime } from './parse-azure-stream-time';

const NOW = new Date('2026-11-10T12:30:00.000Z');

describe('parseAzureStreamTime', () => {
  describe('Standard use cases', () => {
    it('should read a time without a zone as UTC, to the millisecond', () => {
      expect(
        parseAzureStreamTime('2026-11-10T12:00:01.1234567', NOW).toISOString(),
      ).toBe('2026-11-10T12:00:01.123Z');
    });

    it("should read Go's time format", () => {
      expect(
        parseAzureStreamTime(
          '2026-11-10 12:00:01 +0000 UTC',
          NOW,
        ).toISOString(),
      ).toBe('2026-11-10T12:00:01.000Z');
      expect(
        parseAzureStreamTime(
          '2026-11-10 14:00:01.5 +0200 CEST',
          NOW,
        ).toISOString(),
      ).toBe('2026-11-10T12:00:01.500Z');
    });

    it('should read a time with a zone as it is', () => {
      expect(
        parseAzureStreamTime('2026-11-10T12:00:01.25+00:00', NOW).toISOString(),
      ).toBe('2026-11-10T12:00:01.250Z');
    });
  });

  describe('Edge cases', () => {
    it('should fall back to now without a readable time', () => {
      expect(parseAzureStreamTime(undefined, NOW)).toBe(NOW);
      expect(parseAzureStreamTime('', NOW)).toBe(NOW);
      expect(parseAzureStreamTime('yesterday', NOW)).toBe(NOW);
      expect(parseAzureStreamTime(1762776000, NOW)).toBe(NOW);
    });
  });
});
