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

import { validateEnum } from './validate-enum';

const VALID_CPU_VALUES = ['0.5', '1', '2', '4', '8'] as const;
const VALID_MEMORY_VALUES = [
  '256Mi',
  '512Mi',
  '1Gi',
  '2Gi',
  '4Gi',
  '8Gi',
] as const;

describe('validateEnum', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('valid values', () => {
    it('should accept valid cpu value', () => {
      expect(() =>
        validateEnum('1', 'cpu', 'dev.auth-service', VALID_CPU_VALUES),
      ).not.toThrow();
    });

    it('should accept valid memory value', () => {
      expect(() =>
        validateEnum(
          '512Mi',
          'memory',
          'dev.auth-service',
          VALID_MEMORY_VALUES,
        ),
      ).not.toThrow();
    });

    it('should accept first value in list', () => {
      expect(() =>
        validateEnum('0.5', 'cpu', 'dev.auth-service', VALID_CPU_VALUES),
      ).not.toThrow();
    });

    it('should accept last value in list', () => {
      expect(() =>
        validateEnum('8', 'cpu', 'dev.auth-service', VALID_CPU_VALUES),
      ).not.toThrow();
    });
  });

  describe('invalid type', () => {
    it('should throw for number', () => {
      expect(() =>
        validateEnum(1, 'cpu', 'dev.auth-service', VALID_CPU_VALUES),
      ).toThrow(mocks.CliError);
    });

    it('should throw for boolean', () => {
      expect(() =>
        validateEnum(true, 'memory', 'dev.auth-service', VALID_MEMORY_VALUES),
      ).toThrow(mocks.CliError);
    });

    it('should throw for null', () => {
      expect(() =>
        validateEnum(null, 'cpu', 'dev.auth-service', VALID_CPU_VALUES),
      ).toThrow(mocks.CliError);
    });

    it('should throw for object', () => {
      expect(() =>
        validateEnum({}, 'memory', 'dev.auth-service', VALID_MEMORY_VALUES),
      ).toThrow(mocks.CliError);
    });
  });

  describe('invalid value', () => {
    it('should throw for invalid cpu value', () => {
      expect(() =>
        validateEnum('3', 'cpu', 'dev.auth-service', VALID_CPU_VALUES),
      ).toThrow(mocks.CliError);
    });

    it('should throw for invalid memory value', () => {
      expect(() =>
        validateEnum('1GB', 'memory', 'dev.auth-service', VALID_MEMORY_VALUES),
      ).toThrow(mocks.CliError);
    });

    it('should throw for case-sensitive mismatch', () => {
      expect(() =>
        validateEnum(
          '512mi',
          'memory',
          'dev.auth-service',
          VALID_MEMORY_VALUES,
        ),
      ).toThrow(mocks.CliError);
    });
  });

  describe('error messages', () => {
    it('should include field name in error', () => {
      try {
        validateEnum('invalid', 'cpu', 'prod.bff-service', VALID_CPU_VALUES);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('cpu');
        expect((error as Error).message).toContain('prod.bff-service');
      }
    });

    it('should include invalid value in error', () => {
      try {
        validateEnum(
          'invalid-value',
          'memory',
          'dev.auth-service',
          VALID_MEMORY_VALUES,
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('invalid-value');
      }
    });
  });
});
