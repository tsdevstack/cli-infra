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

import { validateFargateCpuMemoryPair } from './validate-fargate-cpu-memory-pair';

describe('validateFargateCpuMemoryPair', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    const validPairs: [string, string][] = [
      ['0.25', '512Mi'],
      ['0.25', '1Gi'],
      ['0.25', '2Gi'],
      ['0.5', '1Gi'],
      ['0.5', '4Gi'],
      ['1', '2Gi'],
      ['1', '8Gi'],
      ['2', '4Gi'],
      ['2', '16Gi'],
      ['4', '8Gi'],
      ['4', '16Gi'],
    ];

    it.each(validPairs)('should accept %s vCPU with %s', (cpu, memory) => {
      expect(() =>
        validateFargateCpuMemoryPair(cpu, memory, 'dev.auth-service'),
      ).not.toThrow();
    });

    const invalidPairs: [string, string][] = [
      ['1', '512Mi'],
      ['1', '1Gi'],
      ['0.25', '4Gi'],
      ['0.5', '512Mi'],
      ['2', '2Gi'],
      ['4', '4Gi'],
    ];

    it.each(invalidPairs)('should reject %s vCPU with %s', (cpu, memory) => {
      expect(() =>
        validateFargateCpuMemoryPair(cpu, memory, 'dev.auth-service'),
      ).toThrow(mocks.CliError);
    });
  });

  describe('Edge cases', () => {
    const thrown = (
      cpu: string,
      memory: string,
    ): { message: string; hint?: string } => {
      try {
        validateFargateCpuMemoryPair(cpu, memory, 'dev.kong');
      } catch (error) {
        return error as { message: string; hint?: string };
      }
      throw new Error('expected a CliError');
    };

    it('should name the memory allowed with that CPU', () => {
      const error = thrown('1', '1Gi');

      expect(error.message).toBe(
        'Invalid AWS Fargate CPU/memory pair "1/1Gi" in dev.kong',
      );
      expect(error.hint).toContain(
        'With 1 vCPU, memory can be 2Gi, 3Gi, 4Gi, 5Gi, 6Gi, 7Gi, 8Gi.',
      );
    });

    it('should list the CPU sizes Fargate takes for an unknown CPU', () => {
      expect(thrown('3', '8Gi').hint).toContain(
        'Fargate takes 0.25, 0.5, 1, 2, 4 vCPU.',
      );
    });
  });
});
