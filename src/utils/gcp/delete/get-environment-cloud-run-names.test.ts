import { describe, it, expect } from '@rstest/core';
import type { FrameworkService } from '@tsdevstack/cli/plugin';
import { getEnvironmentCloudRunNames } from './get-environment-cloud-run-names';

describe('getEnvironmentCloudRunNames', () => {
  describe('Standard use cases', () => {
    it('should list services, workers, Kong and migration jobs', () => {
      const services: FrameworkService[] = [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'bff-service', type: 'nestjs' },
        { name: 'offers-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
        { name: 'react-app', type: 'spa' },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      ];

      expect(getEnvironmentCloudRunNames(services, 'my-app')).toEqual({
        services: [
          'auth-service',
          'bff-service',
          'offers-service',
          'frontend',
          'auth-worker',
          'my-app-kong',
        ],
        jobs: ['migrate-auth-service', 'migrate-offers-service'],
      });
    });

    it('should include detached workers (no base service)', () => {
      const services: FrameworkService[] = [
        { name: 'report-worker', type: 'worker' },
      ];

      expect(getEnvironmentCloudRunNames(services, 'my-app').services).toEqual([
        'report-worker',
        'my-app-kong',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should leave out SPAs, which are storage buckets', () => {
      const services: FrameworkService[] = [{ name: 'react-app', type: 'spa' }];

      expect(getEnvironmentCloudRunNames(services, 'my-app')).toEqual({
        services: ['my-app-kong'],
        jobs: [],
      });
    });

    it('should list Kong even without services', () => {
      expect(getEnvironmentCloudRunNames([], 'my-app')).toEqual({
        services: ['my-app-kong'],
        jobs: [],
      });
    });
  });
});
