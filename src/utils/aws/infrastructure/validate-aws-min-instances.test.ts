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

import { validateAwsMinInstances } from './validate-aws-min-instances';

describe('validateAwsMinInstances', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should accept minInstances 1', () => {
      expect(() =>
        validateAwsMinInstances(1, 'dev.auth-service'),
      ).not.toThrow();
    });

    it('should accept minInstances above 1', () => {
      expect(() => validateAwsMinInstances(3, 'dev.kong')).not.toThrow();
    });

    it('should reject minInstances 0 with a CliError', () => {
      expect(() => validateAwsMinInstances(0, 'dev.auth-service')).toThrow(
        mocks.CliError,
      );
    });
  });

  describe('Error details', () => {
    it('should name the context in the message', () => {
      expect(() => validateAwsMinInstances(0, 'staging.kong')).toThrow(
        'minInstances: 0 is not supported on AWS (staging.kong)',
      );
    });

    it('should include a hint to set 1 or more', () => {
      try {
        validateAwsMinInstances(0, 'dev.auth-service');
        expect.fail('Should have thrown');
      } catch (error) {
        const cliError = error as InstanceType<typeof mocks.CliError>;
        expect(cliError.context).toBe('Infrastructure Config');
        expect(cliError.hint).toContain('AWS has no scale-to-zero');
        expect(cliError.hint).toContain('1 or more');
        expect(cliError.hint).toContain('dev.auth-service');
      }
    });
  });

  describe('Edge cases', () => {
    it('should reject negative values', () => {
      expect(() => validateAwsMinInstances(-1, 'dev.bff-service')).toThrow(
        mocks.CliError,
      );
    });
  });
});
