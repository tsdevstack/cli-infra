import { describe, it, expect } from '@rstest/core';
import { buildCloudMapUrl } from './build-cloud-map-url';

describe('buildCloudMapUrl', () => {
  describe('Standard use cases', () => {
    it('should build the in-VPC URL of a service', () => {
      expect(buildCloudMapUrl('auth-service', 'my-app')).toBe(
        'http://auth-service.my-app.local:8080',
      );
    });

    it('should build the URL the Next.js servers call Kong at', () => {
      expect(buildCloudMapUrl('kong', 'my-app')).toBe(
        'http://kong.my-app.local:8080',
      );
    });
  });
});
