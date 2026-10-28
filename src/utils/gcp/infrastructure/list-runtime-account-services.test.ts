import { describe, it, expect } from '@rstest/core';
import type { FrameworkService } from '@tsdevstack/cli/plugin';
import { listRuntimeAccountServices } from './list-runtime-account-services';

const service = (name: string, type: string): FrameworkService =>
  ({ name, type }) as FrameworkService;

describe('listRuntimeAccountServices', () => {
  describe('Standard use cases', () => {
    it('should give backend services and Next.js apps their own account', () => {
      expect(
        listRuntimeAccountServices([
          service('auth-service', 'nestjs'),
          service('frontend', 'nextjs'),
        ]),
      ).toEqual([{ name: 'auth-service' }, { name: 'frontend' }]);
    });

    it('should leave out workers, which run as their base service, and SPAs', () => {
      expect(
        listRuntimeAccountServices([
          service('auth-service', 'nestjs'),
          service('auth-worker', 'worker'),
          service('react-app', 'spa'),
        ]),
      ).toEqual([{ name: 'auth-service' }]);
    });
  });

  describe('Edge cases', () => {
    it('should return nothing for no services', () => {
      expect(listRuntimeAccountServices([])).toEqual([]);
    });
  });
});
