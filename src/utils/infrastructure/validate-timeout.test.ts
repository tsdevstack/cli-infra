import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateTimeout } from './validate-timeout';

describe('validateTimeout', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('valid values', () => {
    it('should accept minimum timeout (30s)', () => {
      expect(() => validateTimeout('30s', 'dev.auth-service')).not.toThrow();
    });

    it('should accept maximum timeout (3600s)', () => {
      expect(() => validateTimeout('3600s', 'dev.auth-service')).not.toThrow();
    });

    it('should accept timeout in range', () => {
      expect(() => validateTimeout('300s', 'dev.auth-service')).not.toThrow();
    });

    it('should accept 60s', () => {
      expect(() => validateTimeout('60s', 'prod.bff-service')).not.toThrow();
    });
  });

  describe('invalid type', () => {
    it('should throw for number', () => {
      expect(() => validateTimeout(300, 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for null', () => {
      expect(() => validateTimeout(null, 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for boolean', () => {
      expect(() => validateTimeout(true, 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });
  });

  describe('invalid format', () => {
    it('should throw for missing "s" suffix', () => {
      expect(() => validateTimeout('300', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for wrong unit', () => {
      expect(() => validateTimeout('5m', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for float seconds', () => {
      expect(() => validateTimeout('30.5s', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for negative seconds', () => {
      expect(() => validateTimeout('-30s', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for empty string', () => {
      expect(() => validateTimeout('', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for space in value', () => {
      expect(() => validateTimeout('30 s', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });
  });

  describe('out of range', () => {
    it('should throw for value below minimum (29s)', () => {
      expect(() => validateTimeout('29s', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for value above maximum (3601s)', () => {
      expect(() => validateTimeout('3601s', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });

    it('should throw for 0s', () => {
      expect(() => validateTimeout('0s', 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });
  });

  describe('error messages', () => {
    it('should include context in error', () => {
      try {
        validateTimeout('invalid', 'prod.bff-service');
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('prod.bff-service');
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should include value in range error', () => {
      try {
        validateTimeout('10s', 'dev.auth-service');
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('10');
        expect((error as Error).message).toContain('out of range');
      }
    });
  });
});
