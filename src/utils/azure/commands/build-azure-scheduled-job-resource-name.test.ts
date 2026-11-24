import { describe, it, expect } from '@rstest/core';
import { buildAzureScheduledJobResourceName } from './build-azure-scheduled-job-resource-name';

describe('buildAzureScheduledJobResourceName', () => {
  it("should name a trigger's Container App Job {project}-{name}", () => {
    expect(
      buildAzureScheduledJobResourceName('shop', {
        name: 'cleanup-tokens',
        schedule: '0 3 * * *',
        targetService: 'auth-service',
        endpoint: '/auth/jobs/cleanup-tokens',
      }),
    ).toBe('shop-cleanup-tokens');
  });

  it("should name a cron job's Container App Job {project}-cron-{name}", () => {
    expect(
      buildAzureScheduledJobResourceName('shop', {
        name: 'usage-report',
        type: 'cron',
        schedule: '0 3 * * *',
        targetService: 'auth-service',
      }),
    ).toBe('shop-cron-usage-report');
  });
});
