import { describe, it, expect } from '@rstest/core';
import { buildAwsMigrationNames } from './build-aws-migration-names';

describe('buildAwsMigrationNames', () => {
  describe('Standard use cases', () => {
    it("should put the project in the migration's task family and log group", () => {
      expect(buildAwsMigrationNames('myapp', 'auth-service')).toEqual({
        taskFamily: 'myapp-migrate-auth-service',
        logGroupName: '/ecs/myapp/migrate-auth-service',
        legacyTaskFamily: 'migrate-auth-service-migration',
        legacyLogGroupName: '/ecs/migrate-auth-service-migration',
      });
    });
  });

  describe('Edge cases', () => {
    it('should give two projects different names for a service of the same name', () => {
      const a = buildAwsMigrationNames('shop', 'auth-service');
      const b = buildAwsMigrationNames('blog', 'auth-service');

      expect(a.taskFamily).not.toBe(b.taskFamily);
      expect(a.logGroupName).not.toBe(b.logGroupName);
      expect(a.legacyLogGroupName).toBe(b.legacyLogGroupName);
    });
  });
});
