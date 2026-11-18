import { describe, it, expect } from '@rstest/core';
import type { FrameworkService } from '@tsdevstack/cli/plugin';
import { getEnvironmentCloudRunNames } from './get-environment-cloud-run-names';

describe('getEnvironmentCloudRunNames', () => {
  describe('Standard use cases', () => {
    it('should list services, workers, Kong, migration jobs and db-init', () => {
      const services: FrameworkService[] = [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'bff-service', type: 'nestjs' },
        { name: 'offers-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
        { name: 'react-app', type: 'spa' },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      ];

      expect(getEnvironmentCloudRunNames(services, 'my-app', 'legacy')).toEqual(
        {
          services: [
            'auth-service',
            'bff-service',
            'offers-service',
            'frontend',
            'auth-worker',
            'my-app-kong',
          ],
          jobs: [
            'migrate-auth-service',
            'migrate-offers-service',
            'my-app-db-init',
          ],
        },
      );
    });

    it('should include detached workers (no base service)', () => {
      const services: FrameworkService[] = [
        { name: 'report-worker', type: 'worker' },
      ];

      expect(
        getEnvironmentCloudRunNames(services, 'my-app', 'legacy').services,
      ).toEqual(['report-worker', 'my-app-kong']);
    });
  });

  describe('Edge cases', () => {
    it('should leave out SPAs, which are storage buckets', () => {
      const services: FrameworkService[] = [{ name: 'react-app', type: 'spa' }];

      expect(getEnvironmentCloudRunNames(services, 'my-app', 'legacy')).toEqual(
        {
          services: ['my-app-kong'],
          jobs: ['my-app-db-init'],
        },
      );
    });

    it('should list Kong and db-init even without services', () => {
      expect(getEnvironmentCloudRunNames([], 'my-app', 'legacy')).toEqual({
        services: ['my-app-kong'],
        jobs: ['my-app-db-init'],
      });
    });
  });

  describe('Naming scheme', () => {
    it('should put the project in every name but Kong in the unique scheme', () => {
      const services: FrameworkService[] = [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      ];

      expect(getEnvironmentCloudRunNames(services, 'my-app', 'unique')).toEqual(
        {
          services: [
            'my-app-auth-service',
            'my-app-frontend',
            'my-app-auth-worker',
            'my-app-kong',
          ],
          jobs: ['my-app-migrate-auth-service', 'my-app-db-init'],
        },
      );
    });
  });
});
