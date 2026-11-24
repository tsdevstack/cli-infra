import { describe, it, expect, rs } from '@rstest/core';

rs.mock('@tsdevstack/infra-core', () => ({ CRON_JOB_NAME_PREFIX: 'cron-' }));

import { buildAwsCronJobNames } from './build-aws-cron-job-names';

describe('buildAwsCronJobNames', () => {
  it("should name the task family, container and log group with the cron- prefix, and the schedule as a trigger's", () => {
    expect(
      buildAwsCronJobNames('shop', 'auth-service', 'usage-report'),
    ).toEqual({
      taskFamily: 'shop-cron-usage-report',
      containerName: 'cron-usage-report',
      logGroupName: '/ecs/shop/cron-usage-report',
      scheduleName: 'shop-auth-service-usage-report',
    });
  });
});
