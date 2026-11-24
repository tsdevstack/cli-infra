import { describe, it, expect } from '@rstest/core';
import { buildAzureCronJobName } from './build-azure-cron-job-name';

describe('buildAzureCronJobName', () => {
  it('should put the project and the cron prefix in front of the name', () => {
    expect(buildAzureCronJobName('shop', 'usage-report')).toBe(
      'shop-cron-usage-report',
    );
  });

  it("should stay apart from a trigger's job of the same name", () => {
    expect(buildAzureCronJobName('shop', 'cleanup')).not.toBe('shop-cleanup');
  });
});
