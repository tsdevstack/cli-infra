import { describe, it, expect } from '@rstest/core';
import { getCronJobs } from './get-cron-jobs';

const trigger = {
  name: 'cleanup-tokens',
  schedule: '0 */4 * * *',
  targetService: 'auth-service',
  endpoint: '/auth/jobs/cleanup-tokens',
};
const cron = {
  name: 'usage-report',
  type: 'cron',
  schedule: '0 3 * * *',
  targetService: 'auth-service',
  timeout: 1800,
};

describe('getCronJobs', () => {
  it('should return the cron jobs only', () => {
    const config = { dev: { scheduledJobs: [trigger, cron] } };
    expect(getCronJobs(config, 'dev')).toEqual([cron]);
  });

  it('should return nothing without a config, environment or list', () => {
    expect(getCronJobs(null, 'dev')).toEqual([]);
    expect(getCronJobs({ dev: {} }, 'staging')).toEqual([]);
    expect(getCronJobs({ dev: { scheduledJobs: [trigger] } }, 'dev')).toEqual(
      [],
    );
  });
});
