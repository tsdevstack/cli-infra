import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('@tsdevstack/infra-core', () => ({ CRON_JOB_NAME_PREFIX: 'cron-' }));

import { validateAwsCronJobNames } from './validate-aws-cron-job-names';

function cron(name: string, targetService = 'auth-service') {
  return {
    name,
    type: 'cron' as const,
    schedule: '0 3 * * *',
    targetService,
  };
}

/** The error the call throws */
function thrown(call: () => void): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('validateAwsCronJobNames', () => {
  it('should accept schedule names within the 64-character limit', () => {
    // "shop-auth-service-" is 18 characters: 46 are left
    expect(() =>
      validateAwsCronJobNames('shop', [cron('a'.repeat(40))], 'dev'),
    ).not.toThrow();
    expect(() => validateAwsCronJobNames('shop', [], 'dev')).not.toThrow();
  });

  it('should refuse a schedule name over the limit, saying how much room is left', () => {
    const project = 'p'.repeat(30);
    const job = 'a'.repeat(21);
    // "{30 p}-auth-service-" is 44 characters: 20 are left
    expect(
      thrown(() => validateAwsCronJobNames(project, [cron(job)], 'dev')),
    ).toMatchObject({
      message: `dev.scheduledJobs.${job}: the EventBridge schedule name "${project}-auth-service-${job}" is 65 characters; AWS takes at most 64`,
      hint: expect.stringContaining(
        'a cron job name can be at most 20 characters on AWS',
      ),
    });
  });

  it('should say when the project and service names leave no room', () => {
    expect(
      thrown(() =>
        validateAwsCronJobNames('p'.repeat(60), [cron('ab', 'svc')], 'dev'),
      ),
    ).toMatchObject({
      hint: expect.stringContaining('leave no room for a cron job name'),
    });
  });
});
