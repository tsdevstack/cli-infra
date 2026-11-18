import { describe, it, expect } from '@rstest/core';
import { buildGcpStateBucketName } from './build-gcp-state-bucket-name';

describe('buildGcpStateBucketName', () => {
  describe('Standard use cases', () => {
    it('should name the bucket by project and GCP project', () => {
      expect(buildGcpStateBucketName('myapp', 'my-gcp-project')).toBe(
        'myapp-tf-state-my-gcp-project',
      );
    });
  });
});
