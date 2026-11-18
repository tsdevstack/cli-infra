import { describe, it, expect } from '@rstest/core';
import { buildAwsSpaBucketName } from './build-aws-spa-bucket-name';

describe('buildAwsSpaBucketName', () => {
  describe('Standard use cases', () => {
    it('should name the bucket as Terraform does', () => {
      expect(buildAwsSpaBucketName('myapp', 'admin-ui', '123456789012')).toBe(
        'myapp-admin-ui-spa-123456789012',
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep a hyphenated project name as it is', () => {
      expect(buildAwsSpaBucketName('my-app', 'react-app', '000000000001')).toBe(
        'my-app-react-app-spa-000000000001',
      );
    });
  });
});
