import { describe, it, expect } from '@rstest/core';
import { buildAwsJobLineName } from './build-aws-job-line-name';

describe('buildAwsJobLineName', () => {
  describe('Standard use cases', () => {
    it('should use the job key the schedule passes (service and job name)', () => {
      expect(
        buildAwsJobLineName({
          name: 'sync-api-key-usage',
          type: 'job',
          service: 'auth-service',
        }),
      ).toBe('auth-service-sync-api-key-usage');
    });
  });

  describe('Edge cases', () => {
    it('should fall back to the source name without a service', () => {
      expect(buildAwsJobLineName({ name: 'cleanup-tokens', type: 'job' })).toBe(
        'cleanup-tokens',
      );
    });
  });
});
