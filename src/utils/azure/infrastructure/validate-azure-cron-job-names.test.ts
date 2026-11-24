import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateAzureCronJobNames } from './validate-azure-cron-job-names';

function cron(name: string) {
  return {
    name,
    type: 'cron' as const,
    schedule: '0 3 * * *',
    targetService: 'auth-service',
  };
}

describe('validateAzureCronJobNames', () => {
  it('should accept names that fit the 32-character Container App Job limit', () => {
    // "shop-cron-" is 10 characters: 22 are left
    expect(() =>
      validateAzureCronJobNames('shop', [cron('a'.repeat(22))], 'dev'),
    ).not.toThrow();
    expect(() => validateAzureCronJobNames('shop', [], 'dev')).not.toThrow();
  });

  it('should refuse a name that makes the job name too long, saying how much room the project leaves', () => {
    expect(() =>
      validateAzureCronJobNames('shop', [cron('a'.repeat(23))], 'dev'),
    ).toThrow(
      `dev.scheduledJobs.${'a'.repeat(23)}: the Container App Job name "shop-cron-${'a'.repeat(23)}" is 33 characters; Azure takes at most 32`,
    );
    try {
      validateAzureCronJobNames('shop', [cron('a'.repeat(23))], 'dev');
    } catch (error) {
      expect((error as { hint?: string }).hint).toContain(
        'a cron job name can be at most 22 characters on Azure',
      );
    }
  });

  it('should say when the project name itself leaves no room', () => {
    try {
      validateAzureCronJobNames('p'.repeat(28), [cron('ab')], 'dev');
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as { hint?: string }).hint).toContain('leaves no room');
    }
  });
});
