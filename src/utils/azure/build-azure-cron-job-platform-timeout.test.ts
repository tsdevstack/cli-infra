import { describe, it, expect } from '@rstest/core';
import { buildAzureCronJobPlatformTimeout } from './build-azure-cron-job-platform-timeout';

describe('buildAzureCronJobPlatformTimeout', () => {
  describe('Standard use cases', () => {
    it("should give Azure the job's timeout, the 60 s margin and the 5-minute start allowance", () => {
      expect(buildAzureCronJobPlatformTimeout(600)).toBe(600 + 60 + 300);
    });

    it('should leave the runner first even after a slow start', () => {
      // az7: the container started 88 s after the run was created; the
      // runner stops at most 60 s + 8 s grace + 1 s lock release after that
      const timeout = 60;
      const runnerDone = 88 + timeout + 8 + 1;

      expect(buildAzureCronJobPlatformTimeout(timeout)).toBeGreaterThan(
        runnerDone,
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep the allowance for the shortest timeout', () => {
      expect(buildAzureCronJobPlatformTimeout(1)).toBe(361);
    });
  });
});
