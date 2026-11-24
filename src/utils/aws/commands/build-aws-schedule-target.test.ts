import { describe, it, expect, rs } from '@rstest/core';

rs.mock('@tsdevstack/infra-core', () => ({
  isCronJob: (job: { type?: string }) => job.type === 'cron',
}));

import { buildAwsScheduleTarget } from './build-aws-schedule-target';

describe('buildAwsScheduleTarget', () => {
  it("should address a trigger's schedule by its service and name", () => {
    expect(
      buildAwsScheduleTarget({
        name: 'cleanup-tokens',
        schedule: '0 3 * * *',
        targetService: 'auth-service',
        endpoint: '/auth/jobs/cleanup-tokens',
      }),
    ).toBe('aws_scheduler_schedule.job["auth-service-cleanup-tokens"]');
  });

  it("should address a cron job's schedule by its name", () => {
    expect(
      buildAwsScheduleTarget({
        name: 'usage-report',
        type: 'cron',
        schedule: '0 3 * * *',
        targetService: 'auth-service',
      }),
    ).toBe('aws_scheduler_schedule.cron_job["usage-report"]');
  });
});
