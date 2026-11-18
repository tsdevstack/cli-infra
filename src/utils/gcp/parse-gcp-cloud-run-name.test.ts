import { describe, it, expect } from '@rstest/core';
import { parseGcpCloudRunName } from './parse-gcp-cloud-run-name';

describe('parseGcpCloudRunName', () => {
  describe('Standard use cases', () => {
    it('should strip the project in the unique scheme', () => {
      expect(
        parseGcpCloudRunName('myapp', 'myapp-auth-service', 'unique'),
      ).toBe('auth-service');
    });

    it('should return the name as it is in a legacy environment', () => {
      expect(parseGcpCloudRunName('myapp', 'auth-service', 'legacy')).toBe(
        'auth-service',
      );
    });
  });

  describe('Edge cases', () => {
    it("should skip another project's service in the unique scheme", () => {
      expect(
        parseGcpCloudRunName('myapp', 'other-auth-service', 'unique'),
      ).toBeUndefined();
      expect(parseGcpCloudRunName('myapp', 'myapp-', 'unique')).toBeUndefined();
    });
  });
});
