import { describe, it, expect } from '@rstest/core';
import { getGcpProjectServiceName } from './get-gcp-project-service-name';

const label = (project: string) => ({ 'tsdevstack-project': project });

describe('getGcpProjectServiceName', () => {
  describe('Standard use cases', () => {
    it("should give the config name of this project's service", () => {
      expect(
        getGcpProjectServiceName(
          'shop',
          { name: 'shop-auth-service', labels: label('shop') },
          'unique',
        ),
      ).toBe('auth-service');
    });

    it('should take every service of a legacy environment by its name', () => {
      expect(
        getGcpProjectServiceName('shop', { name: 'auth-service' }, 'legacy'),
      ).toBe('auth-service');
    });
  });

  describe('Edge cases', () => {
    it('should skip a project whose name starts with this one', () => {
      expect(
        getGcpProjectServiceName(
          'shop',
          { name: 'shop-admin-auth-service', labels: label('shop-admin') },
          'unique',
        ),
      ).toBeUndefined();
    });

    it('should skip a service without the label in the unique scheme', () => {
      expect(
        getGcpProjectServiceName(
          'shop',
          { name: 'shop-auth-service' },
          'unique',
        ),
      ).toBeUndefined();
    });
  });
});
