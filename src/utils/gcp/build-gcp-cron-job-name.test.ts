import { describe, it, expect } from '@rstest/core';
import { buildGcpCronJobName } from './build-gcp-cron-job-name';

describe('buildGcpCronJobName', () => {
  it('should be cron-{name} in a legacy environment', () => {
    expect(buildGcpCronJobName('shop', 'usage-report', 'legacy')).toBe(
      'cron-usage-report',
    );
  });

  it('should carry the project in the unique scheme', () => {
    expect(buildGcpCronJobName('shop', 'usage-report', 'unique')).toBe(
      'shop-cron-usage-report',
    );
  });
});
