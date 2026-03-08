import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateAzureCpuMemoryPair } from './validate-azure-cpu-memory-pair';

describe('validateAzureCpuMemoryPair', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('valid pairs', () => {
    const validPairs: [string, string][] = [
      ['0.25', '0.5Gi'],
      ['0.5', '1Gi'],
      ['0.75', '1.5Gi'],
      ['1', '2Gi'],
      ['1.25', '2.5Gi'],
      ['1.5', '3Gi'],
      ['1.75', '3.5Gi'],
      ['2', '4Gi'],
      ['2.25', '4.5Gi'],
      ['2.5', '5Gi'],
      ['2.75', '5.5Gi'],
      ['3', '6Gi'],
      ['3.25', '6.5Gi'],
      ['3.5', '7Gi'],
      ['3.75', '7.5Gi'],
      ['4', '8Gi'],
    ];

    for (const [cpu, memory] of validPairs) {
      it(`should accept valid pair ${cpu}/${memory}`, () => {
        expect(() =>
          validateAzureCpuMemoryPair(cpu, memory, 'dev.auth-service'),
        ).not.toThrow();
      });
    }
  });

  describe('invalid pairs', () => {
    it('should reject cpu 1 with memory 0.5Gi', () => {
      expect(() =>
        validateAzureCpuMemoryPair('1', '0.5Gi', 'dev.auth-service'),
      ).toThrow(mocks.CliError);
    });

    it('should reject cpu 0.25 with memory 2Gi', () => {
      expect(() =>
        validateAzureCpuMemoryPair('0.25', '2Gi', 'dev.auth-service'),
      ).toThrow(mocks.CliError);
    });

    it('should reject cpu 4 with memory 2Gi', () => {
      expect(() =>
        validateAzureCpuMemoryPair('4', '2Gi', 'dev.auth-service'),
      ).toThrow(mocks.CliError);
    });

    it('should reject cpu 2 with memory 1Gi', () => {
      expect(() =>
        validateAzureCpuMemoryPair('2', '1Gi', 'dev.auth-service'),
      ).toThrow(mocks.CliError);
    });

    it('should include cpu/memory values in error message', () => {
      try {
        validateAzureCpuMemoryPair('1', '0.5Gi', 'prod.bff-service');
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('1/0.5Gi');
        expect((error as Error).message).toContain('prod.bff-service');
      }
    });

    it('should include valid pairs hint in error', () => {
      try {
        validateAzureCpuMemoryPair('1', '4Gi', 'dev.auth-service');
        expect.fail('Should have thrown');
      } catch (error) {
        const hint = (error as { hint?: string }).hint;
        expect(hint).toContain('Valid pairs');
      }
    });
  });
});
