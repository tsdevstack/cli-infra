import { describe, it, expect } from '@rstest/core';
import { buildAwsJobKey } from './build-aws-job-key';

describe('buildAwsJobKey', () => {
  describe('Standard use cases', () => {
    it('should put the target service before the job name', () => {
      expect(buildAwsJobKey('auth-service', 'sync-api-key-usage')).toBe(
        'auth-service-sync-api-key-usage',
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep jobs of the same name on two services apart', () => {
      expect(buildAwsJobKey('auth-service', 'cleanup')).not.toBe(
        buildAwsJobKey('offers-service', 'cleanup'),
      );
    });
  });
});
