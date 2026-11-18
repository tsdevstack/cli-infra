import { describe, it, expect } from '@rstest/core';
import { buildGcpMigrationJobName } from './build-gcp-migration-job-name';

describe('buildGcpMigrationJobName', () => {
  describe('Standard use cases', () => {
    it('should keep migrate-{service} in a legacy environment', () => {
      expect(buildGcpMigrationJobName('myapp', 'auth-service', 'legacy')).toBe(
        'migrate-auth-service',
      );
    });

    it('should put the project in front in the unique scheme', () => {
      expect(buildGcpMigrationJobName('myapp', 'auth-service', 'unique')).toBe(
        'myapp-migrate-auth-service',
      );
    });
  });
});
