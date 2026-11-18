import { describe, it, expect } from '@rstest/core';
import { buildGcpSpaBucketName } from './build-gcp-spa-bucket-name';

describe('buildGcpSpaBucketName', () => {
  describe('Standard use cases', () => {
    it('should name the bucket as Terraform does, with the GCP project ID', () => {
      expect(buildGcpSpaBucketName('myapp', 'landing', 'my-gcp-project')).toBe(
        'myapp-landing-spa-my-gcp-project',
      );
    });
  });
});
