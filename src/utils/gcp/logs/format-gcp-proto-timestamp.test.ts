import { describe, it, expect } from '@rstest/core';
import { formatGcpProtoTimestamp } from './format-gcp-proto-timestamp';

describe('formatGcpProtoTimestamp', () => {
  describe('Standard use cases', () => {
    it('should write a protobuf timestamp as RFC 3339 text', () => {
      expect(
        formatGcpProtoTimestamp({ seconds: '1762776000', nanos: 123000000 }),
      ).toBe('2025-11-10T12:00:00.123Z');
    });

    it('should keep 6 or 9 digits when the nanoseconds need them', () => {
      expect(
        formatGcpProtoTimestamp({ seconds: '1762776000', nanos: 123456000 }),
      ).toBe('2025-11-10T12:00:00.123456Z');
      expect(
        formatGcpProtoTimestamp({ seconds: '1762776000', nanos: 123456789 }),
      ).toBe('2025-11-10T12:00:00.123456789Z');
      expect(formatGcpProtoTimestamp({ seconds: '1762776000', nanos: 5 })).toBe(
        '2025-11-10T12:00:00.000000005Z',
      );
    });

    it('should leave out the fraction on a whole second', () => {
      expect(formatGcpProtoTimestamp({ seconds: 1762776000, nanos: 0 })).toBe(
        '2025-11-10T12:00:00Z',
      );
    });

    it('should take a Date (the SDK converts the entry timestamp)', () => {
      expect(
        formatGcpProtoTimestamp(new Date('2026-11-10T12:00:00.250Z')),
      ).toBe('2026-11-10T12:00:00.250Z');
    });
  });

  describe('Edge cases', () => {
    it('should treat missing, empty and zero timestamps as unset', () => {
      expect(formatGcpProtoTimestamp(undefined)).toBeUndefined();
      expect(formatGcpProtoTimestamp(null)).toBeUndefined();
      expect(formatGcpProtoTimestamp('')).toBeUndefined();
      expect(
        formatGcpProtoTimestamp({ seconds: '0', nanos: 0 }),
      ).toBeUndefined();
    });

    it('should keep text as it is', () => {
      expect(formatGcpProtoTimestamp('2026-11-10T12:00:00Z')).toBe(
        '2026-11-10T12:00:00Z',
      );
    });

    it('should refuse values that are not a timestamp', () => {
      expect(formatGcpProtoTimestamp(new Date('nope'))).toBeUndefined();
      expect(
        formatGcpProtoTimestamp({ seconds: 'abc', nanos: 0 }),
      ).toBeUndefined();
      expect(
        formatGcpProtoTimestamp({ seconds: '1', nanos: 1e9 }),
      ).toBeUndefined();
    });
  });
});
