import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateTracingOverride } from './validate-tracing-override';

describe('validateTracingOverride', () => {
  describe('Standard use cases', () => {
    it('should accept a rate from 0 to 1, or none', () => {
      expect(() =>
        validateTracingOverride('dev', { sampleRate: 0 }),
      ).not.toThrow();
      expect(() =>
        validateTracingOverride('dev', { sampleRate: 0.25 }),
      ).not.toThrow();
      expect(() =>
        validateTracingOverride('dev', { sampleRate: 1 }),
      ).not.toThrow();
      expect(() => validateTracingOverride('dev', {})).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should reject a rate outside 0 to 1 or not a number', () => {
      expect(() => validateTracingOverride('dev', { sampleRate: 1.5 })).toThrow(
        '"tracing.sampleRate" must be a number from 0 to 1 (dev.tracing.sampleRate)',
      );
      expect(() =>
        validateTracingOverride('dev', { sampleRate: -0.1 }),
      ).toThrow();
      expect(() =>
        validateTracingOverride('dev', { sampleRate: '0.5' }),
      ).toThrow();
    });

    it('should reject an unknown field', () => {
      expect(() => validateTracingOverride('prod', { rate: 0.5 })).toThrow(
        'Unknown field "rate" in prod.tracing',
      );
    });

    it('should reject anything but an object', () => {
      expect(() => validateTracingOverride('dev', 0.5)).toThrow(
        '"tracing" must be an object (dev.tracing)',
      );
      expect(() => validateTracingOverride('dev', [0.5])).toThrow();
    });
  });
});
