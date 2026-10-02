import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateAccessControl } from './validate-access-control';

function captureError(fn: () => void): { message: string; hint?: string } {
  try {
    fn();
  } catch (error) {
    return error as { message: string; hint?: string };
  }
  throw new Error('Expected function to throw');
}

describe('validateAccessControl', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should accept noIndex', () => {
      expect(() =>
        validateAccessControl('staging', { noIndex: true }),
      ).not.toThrow();
    });

    it('should accept an empty accessControl block', () => {
      expect(() => validateAccessControl('staging', {})).not.toThrow();
    });

    it('should reject protected', () => {
      expect(() =>
        validateAccessControl('staging', { protected: true, noIndex: true }),
      ).toThrow(mocks.CliError);
    });

    it('should reject cookieTtlHours', () => {
      expect(() =>
        validateAccessControl('staging', { cookieTtlHours: 24 }),
      ).toThrow(mocks.CliError);
    });

    it('should reject protected even when set to false', () => {
      expect(() => validateAccessControl('dev', { protected: false })).toThrow(
        mocks.CliError,
      );
    });

    it('should name the field and environment in the message', () => {
      const error = captureError(() =>
        validateAccessControl('staging', { cookieTtlHours: 24 }),
      );
      expect(error.message).toContain('accessControl.cookieTtlHours');
      expect(error.message).toContain('staging');
    });

    it('should hint that password protection was removed', () => {
      const error = captureError(() =>
        validateAccessControl('staging', { protected: true }),
      );
      expect(error.hint).toContain('password protection was removed');
    });
  });

  describe('Edge cases', () => {
    it('should ignore undefined', () => {
      expect(() => validateAccessControl('dev', undefined)).not.toThrow();
    });

    it('should ignore null', () => {
      expect(() => validateAccessControl('dev', null)).not.toThrow();
    });
  });
});
