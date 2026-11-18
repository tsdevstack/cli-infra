import { describe, it, expect } from '@rstest/core';
import { formatGcpProtoDuration } from './format-gcp-proto-duration';

describe('formatGcpProtoDuration', () => {
  describe('Standard use cases', () => {
    it('should write a protobuf duration as the REST text', () => {
      expect(formatGcpProtoDuration({ seconds: '0', nanos: 12000000 })).toBe(
        '0.012s',
      );
      expect(formatGcpProtoDuration({ seconds: '2', nanos: 500000 })).toBe(
        '2.000500s',
      );
      expect(formatGcpProtoDuration({ seconds: '0', nanos: 1 })).toBe(
        '0.000000001s',
      );
    });

    it('should leave out the fraction on whole seconds', () => {
      expect(formatGcpProtoDuration({ seconds: '3', nanos: 0 })).toBe('3s');
    });
  });

  describe('Edge cases', () => {
    it('should treat missing and zero durations as unset', () => {
      expect(formatGcpProtoDuration(undefined)).toBeUndefined();
      expect(formatGcpProtoDuration(null)).toBeUndefined();
      expect(
        formatGcpProtoDuration({ seconds: '0', nanos: 0 }),
      ).toBeUndefined();
    });

    it('should keep text as it is', () => {
      expect(formatGcpProtoDuration('0.5s')).toBe('0.5s');
    });

    it('should refuse values that are not a duration', () => {
      expect(
        formatGcpProtoDuration({ seconds: '-1', nanos: 0 }),
      ).toBeUndefined();
      expect(
        formatGcpProtoDuration({ seconds: '1.5', nanos: 0 }),
      ).toBeUndefined();
    });
  });
});
