import { describe, it, expect } from '@rstest/core';
import { getScheduledJobs } from './get-scheduled-jobs';

describe('getScheduledJobs', () => {
  describe('no config', () => {
    it('should return empty array when config is null', () => {
      const result = getScheduledJobs(null, 'dev');
      expect(result).toEqual([]);
    });
  });

  describe('missing environment', () => {
    it('should return empty array when environment does not exist', () => {
      const config = { dev: {} };
      const result = getScheduledJobs(config, 'staging');
      expect(result).toEqual([]);
    });

    it('should return empty array when environment is not an object', () => {
      const config = { dev: 'invalid' };
      const result = getScheduledJobs(config, 'dev');
      expect(result).toEqual([]);
    });
  });

  describe('no scheduled jobs', () => {
    it('should return empty array when scheduledJobs not defined', () => {
      const config = {
        dev: {
          database: { tier: 'db-f1-micro' },
        },
      };
      const result = getScheduledJobs(config, 'dev');
      expect(result).toEqual([]);
    });

    it('should return empty array when scheduledJobs is undefined', () => {
      const config = {
        dev: {
          scheduledJobs: undefined,
        },
      };
      const result = getScheduledJobs(config, 'dev');
      expect(result).toEqual([]);
    });
  });

  describe('with scheduled jobs', () => {
    it('should return scheduled jobs array', () => {
      const config = {
        dev: {
          scheduledJobs: [
            {
              name: 'cleanup-tokens',
              schedule: '0 */4 * * *',
              targetService: 'auth-service',
              endpoint: '/jobs/cleanup-tokens',
            },
          ],
        },
      };
      const result = getScheduledJobs(config, 'dev');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('cleanup-tokens');
    });

    it('should return multiple scheduled jobs', () => {
      const config = {
        dev: {
          scheduledJobs: [
            {
              name: 'cleanup-tokens',
              schedule: '0 */4 * * *',
              targetService: 'auth-service',
              endpoint: '/jobs/cleanup-tokens',
            },
            {
              name: 'send-digest',
              schedule: '0 9 * * 1',
              targetService: 'notification-service',
              endpoint: '/jobs/weekly-digest',
            },
          ],
        },
      };
      const result = getScheduledJobs(config, 'dev');
      expect(result).toHaveLength(2);
    });

    it('should return jobs with optional fields', () => {
      const config = {
        dev: {
          scheduledJobs: [
            {
              name: 'daily-report',
              schedule: '0 9 * * *',
              targetService: 'reports-service',
              endpoint: '/jobs/generate',
              method: 'GET',
              httpTimeout: 600,
              timezone: 'America/New_York',
            },
          ],
        },
      };
      const result = getScheduledJobs(config, 'dev');
      expect(result[0].method).toBe('GET');
      expect(result[0].httpTimeout).toBe(600);
      expect(result[0].timezone).toBe('America/New_York');
    });
  });

  describe('environment isolation', () => {
    it('should only return jobs for specified environment', () => {
      const config = {
        dev: {
          scheduledJobs: [
            {
              name: 'dev-job',
              schedule: '* * * * *',
              targetService: 'auth-service',
              endpoint: '/jobs/dev',
            },
          ],
        },
        staging: {
          scheduledJobs: [
            {
              name: 'staging-job',
              schedule: '0 * * * *',
              targetService: 'auth-service',
              endpoint: '/jobs/staging',
            },
          ],
        },
      };
      const devResult = getScheduledJobs(config, 'dev');
      const stagingResult = getScheduledJobs(config, 'staging');

      expect(devResult[0].name).toBe('dev-job');
      expect(stagingResult[0].name).toBe('staging-job');
    });
  });
});
