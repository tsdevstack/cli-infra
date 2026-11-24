import { describe, it, expect } from '@rstest/core';
import { getTriggerJobs } from './get-trigger-jobs';

const trigger = {
  name: 'cleanup-tokens',
  schedule: '0 */4 * * *',
  targetService: 'auth-service',
  endpoint: '/auth/jobs/cleanup-tokens',
};
const typedTrigger = { ...trigger, name: 'typed', type: 'trigger' };
const cron = {
  name: 'usage-report',
  type: 'cron',
  schedule: '0 3 * * *',
  targetService: 'auth-service',
};

describe('getTriggerJobs', () => {
  it('should return the triggers only, typed or not', () => {
    const config = { dev: { scheduledJobs: [trigger, cron, typedTrigger] } };
    expect(getTriggerJobs(config, 'dev')).toEqual([trigger, typedTrigger]);
  });

  it('should return nothing without a config, environment or list', () => {
    expect(getTriggerJobs(null, 'dev')).toEqual([]);
    expect(getTriggerJobs({ dev: {} }, 'staging')).toEqual([]);
    expect(getTriggerJobs({ dev: {} }, 'dev')).toEqual([]);
  });
});
