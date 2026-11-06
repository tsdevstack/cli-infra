import { describe, it, expect } from '@rstest/core';
import { getTraceSampleRate } from './get-trace-sample-rate';

describe('getTraceSampleRate', () => {
  describe('Standard use cases', () => {
    it("should read the environment's tracing.sampleRate", () => {
      const config = { dev: { tracing: { sampleRate: 0.1 } } };
      expect(getTraceSampleRate(config, 'dev')).toBe(0.1);
    });

    it('should keep every trace when the environment sets no rate', () => {
      expect(getTraceSampleRate({ dev: {} }, 'dev')).toBe(1);
      expect(getTraceSampleRate({ dev: { tracing: {} } }, 'dev')).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should keep every trace without a config or environment', () => {
      expect(getTraceSampleRate(null, 'dev')).toBe(1);
      expect(getTraceSampleRate({ prod: {} }, 'dev')).toBe(1);
    });

    it('should keep a rate of 0', () => {
      expect(
        getTraceSampleRate({ dev: { tracing: { sampleRate: 0 } } }, 'dev'),
      ).toBe(0);
    });
  });
});
