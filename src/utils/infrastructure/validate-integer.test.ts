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

import { validateInteger } from './validate-integer';

describe('validateInteger', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('valid values', () => {
    it('should accept integer at minimum', () => {
      expect(() =>
        validateInteger(0, 'minInstances', 'dev.auth-service', 0, 100),
      ).not.toThrow();
    });

    it('should accept integer at maximum', () => {
      expect(() =>
        validateInteger(100, 'maxInstances', 'dev.auth-service', 0, 100),
      ).not.toThrow();
    });

    it('should accept integer in range', () => {
      expect(() =>
        validateInteger(50, 'port', 'dev.auth-service', 1, 65535),
      ).not.toThrow();
    });
  });

  describe('invalid type', () => {
    it('should throw for string', () => {
      expect(() =>
        validateInteger('5', 'minInstances', 'dev.auth-service', 0, 100),
      ).toThrow(mocks.CliError);
    });

    it('should throw for float', () => {
      expect(() =>
        validateInteger(5.5, 'minInstances', 'dev.auth-service', 0, 100),
      ).toThrow(mocks.CliError);
    });

    it('should throw for null', () => {
      expect(() =>
        validateInteger(null, 'minInstances', 'dev.auth-service', 0, 100),
      ).toThrow(mocks.CliError);
    });

    it('should throw for boolean', () => {
      expect(() =>
        validateInteger(true, 'minInstances', 'dev.auth-service', 0, 100),
      ).toThrow(mocks.CliError);
    });
  });

  describe('out of range', () => {
    it('should throw for value below minimum', () => {
      expect(() =>
        validateInteger(-1, 'minInstances', 'dev.auth-service', 0, 100),
      ).toThrow(mocks.CliError);
    });

    it('should throw for value above maximum', () => {
      expect(() =>
        validateInteger(101, 'maxInstances', 'dev.auth-service', 0, 100),
      ).toThrow(mocks.CliError);
    });
  });

  describe('error messages', () => {
    it('should include field name in error', () => {
      try {
        validateInteger('test', 'port', 'prod.bff-service', 1, 65535);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('port');
        expect((error as Error).message).toContain('prod.bff-service');
      }
    });

    it('should include range in error for out of range', () => {
      try {
        validateInteger(200, 'maxInstances', 'dev.auth-service', 1, 100);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('200');
        expect((error as Error).message).toContain('out of range');
      }
    });
  });
});
