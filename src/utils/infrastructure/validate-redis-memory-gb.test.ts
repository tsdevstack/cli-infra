import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateRedisMemoryGb } from './validate-redis-memory-gb';

function captureError(fn: () => void): { message: string; hint?: string } {
  try {
    fn();
  } catch (error) {
    return error as { message: string; hint?: string };
  }
  throw new Error('Expected function to throw');
}

describe('validateRedisMemoryGb', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should do nothing when memoryGb is not set', () => {
      for (const provider of ['gcp', 'aws', 'azure'] as const) {
        expect(() =>
          validateRedisMemoryGb('dev', undefined, provider),
        ).not.toThrow();
      }
    });

    it('should accept memoryGb within range on GCP', () => {
      expect(() => validateRedisMemoryGb('dev', 1, 'gcp')).not.toThrow();
      expect(() => validateRedisMemoryGb('dev', 300, 'gcp')).not.toThrow();
    });
  });

  describe('Provider limits', () => {
    it('should reject memoryGb on AWS', () => {
      const error = captureError(() => validateRedisMemoryGb('dev', 2, 'aws'));

      expect(error.message).toContain(
        '"redis.memoryGb" is not supported on AWS',
      );
      expect(error.message).toContain('dev.redis.memoryGb');
      expect(error.hint).toContain('tier');
    });

    it('should reject memoryGb on Azure', () => {
      expect(() => validateRedisMemoryGb('prod', 1, 'azure')).toThrow(
        '"redis.memoryGb" is not supported on AZURE',
      );
    });
  });

  describe('Edge cases', () => {
    it('should reject out-of-range or fractional sizes on GCP', () => {
      expect(() => validateRedisMemoryGb('dev', 0, 'gcp')).toThrow();
      expect(() => validateRedisMemoryGb('dev', 301, 'gcp')).toThrow();
      expect(() => validateRedisMemoryGb('dev', 1.5, 'gcp')).toThrow();
      expect(() => validateRedisMemoryGb('dev', '2', 'gcp')).toThrow();
    });
  });
});
