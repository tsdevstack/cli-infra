import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateScheduledJobs } from './validate-scheduled-jobs';

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'cleanup-tokens',
    schedule: '0 3 * * *',
    targetService: 'auth-service',
    endpoint: '/auth/jobs/cleanup-tokens',
    ...overrides,
  };
}

function hintOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { hint?: string }).hint;
  }
  return undefined;
}

describe('validateScheduledJobs', () => {
  describe('Standard use cases', () => {
    it('should accept a job without method or httpTimeout on every cloud', () => {
      for (const provider of ['gcp', 'aws', 'azure'] as const) {
        expect(() =>
          validateScheduledJobs('dev', [job()], provider),
        ).not.toThrow();
      }
    });

    it("should accept each cloud's own limits", () => {
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 1800 })], 'gcp'),
      ).not.toThrow();
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 890 })], 'aws'),
      ).not.toThrow();
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 240 })], 'azure'),
      ).not.toThrow();
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 15 })], 'azure'),
      ).not.toThrow();
    });

    it('should accept every HTTP method the clouds send', () => {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        expect(() =>
          validateScheduledJobs('dev', [job({ method })], 'aws'),
        ).not.toThrow();
      }
    });
  });

  describe('Edge cases', () => {
    it("should reject an httpTimeout above the cloud's limit, with the reason", () => {
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 300 })], 'azure'),
      ).toThrow(
        'dev.scheduledJobs.cleanup-tokens.httpTimeout: 300 is not a whole number of seconds from 15 to 240',
      );
      expect(
        hintOf(() =>
          validateScheduledJobs('dev', [job({ httpTimeout: 300 })], 'azure'),
        ),
      ).toContain('240 s');
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 900 })], 'aws'),
      ).toThrow('from 15 to 890');
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 1801 })], 'gcp'),
      ).toThrow('from 15 to 1800');
    });

    it('should reject an httpTimeout below 15 s with its own hint', () => {
      const run = (): void =>
        validateScheduledJobs('dev', [job({ httpTimeout: 10 })], 'aws');

      expect(run).toThrow('from 15 to 890');
      expect(hintOf(run)).toContain("Cloud Scheduler's minimum");
    });

    it('should reject an httpTimeout that is not a whole number', () => {
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: 30.5 })], 'gcp'),
      ).toThrow();
      expect(() =>
        validateScheduledJobs('dev', [job({ httpTimeout: '30' })], 'gcp'),
      ).toThrow();
    });

    it('should reject an unknown method', () => {
      expect(() =>
        validateScheduledJobs('dev', [job({ method: 'HEAD' })], 'gcp'),
      ).toThrow(
        'dev.scheduledJobs.cleanup-tokens.method: invalid value "HEAD"',
      );
    });

    it('should reject an unknown field, such as timeout for httpTimeout', () => {
      expect(() =>
        validateScheduledJobs('dev', [job({ timeout: 60 })], 'gcp'),
      ).toThrow('Unknown field "timeout" in dev.scheduledJobs.cleanup-tokens');
    });

    it('should reject a list that is not a list, and a job that is not an object', () => {
      expect(() => validateScheduledJobs('dev', {}, 'gcp')).toThrow(
        '"scheduledJobs" must be a list (dev.scheduledJobs)',
      );
      expect(() => validateScheduledJobs('dev', ['x'], 'gcp')).toThrow(
        'dev.scheduledJobs[0] must be an object',
      );
    });

    it('should accept a time zone on GCP and AWS, and only UTC on Azure', () => {
      expect(() =>
        validateScheduledJobs(
          'dev',
          [job({ timezone: 'Europe/Budapest' })],
          'gcp',
        ),
      ).not.toThrow();
      expect(() =>
        validateScheduledJobs(
          'dev',
          [job({ timezone: 'America/New_York' })],
          'aws',
        ),
      ).not.toThrow();
      expect(() =>
        validateScheduledJobs('dev', [job({ timezone: 'UTC' })], 'azure'),
      ).not.toThrow();
      expect(() =>
        validateScheduledJobs('dev', [job({ timezone: 'Etc/UTC' })], 'azure'),
      ).not.toThrow();

      const run = (): void =>
        validateScheduledJobs(
          'dev',
          [job({ timezone: 'Europe/Budapest' })],
          'azure',
        );
      expect(run).toThrow(
        'dev.scheduledJobs.cleanup-tokens.timezone: "Europe/Budapest" is not possible on Azure',
      );
      expect(hintOf(run)).toContain('Write the schedule in UTC');
    });

    it('should reject a name that is not a time zone', () => {
      expect(() =>
        validateScheduledJobs('dev', [job({ timezone: 'Budapest' })], 'aws'),
      ).toThrow(
        'dev.scheduledJobs.cleanup-tokens.timezone: "Budapest" is not a time zone',
      );
      expect(() =>
        validateScheduledJobs('dev', [job({ timezone: 1 })], 'gcp'),
      ).toThrow('is not a time zone');
    });

    it('should name a job without a name by its position', () => {
      expect(() =>
        validateScheduledJobs('dev', [{ httpTimeout: 5 }], 'gcp'),
      ).toThrow('dev.scheduledJobs.0.httpTimeout');
    });
  });
});
