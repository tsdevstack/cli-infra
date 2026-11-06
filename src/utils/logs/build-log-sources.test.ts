import { describe, it, expect } from '@rstest/core';
import type { FrameworkService } from '@tsdevstack/cli/plugin';
import { buildLogSources } from './build-log-sources';

const SERVICES: FrameworkService[] = [
  { name: 'auth-service', type: 'nestjs', port: 3001, hasDatabase: true },
  { name: 'bff-service', type: 'nestjs', port: 3002, hasDatabase: false },
  { name: 'frontend', type: 'nextjs', port: 3000 },
  { name: 'react-app', type: 'spa', port: 3005 },
  { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
];

describe('buildLogSources', () => {
  describe('Standard use cases', () => {
    it('should list every source of the environment in a fixed order', () => {
      const sources = buildLogSources(SERVICES, [
        {
          name: 'sync-api-key-usage',
          schedule: '*/5 * * * *',
          targetService: 'auth-service',
          endpoint: '/jobs/sync-api-key-usage',
        },
      ]);

      expect(sources).toEqual([
        { name: 'auth-service', type: 'service' },
        { name: 'bff-service', type: 'service' },
        { name: 'auth-worker', type: 'worker' },
        { name: 'frontend', type: 'frontend' },
        { name: 'kong', type: 'kong' },
        { name: 'migrate-auth-service', type: 'migration' },
        {
          name: 'sync-api-key-usage',
          type: 'job',
          service: 'auth-service',
        },
        { name: 'edge', type: 'edge' },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should leave out SPAs, which log nothing of their own', () => {
      const names = buildLogSources(SERVICES, []).map((s) => s.name);
      expect(names).not.toContain('react-app');
    });

    it('should still list Kong and the edge without services', () => {
      expect(buildLogSources([], [])).toEqual([
        { name: 'kong', type: 'kong' },
        { name: 'edge', type: 'edge' },
      ]);
    });
  });
});
