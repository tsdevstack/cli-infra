import { describe, it, expect } from '@rstest/core';
import { getFrontendServicesWithDomains } from './get-frontend-services-with-domains';
import type { EnvironmentOverrides } from './types';

describe('getFrontendServicesWithDomains', () => {
  describe('Standard use cases', () => {
    it('should extract frontend service with domain', () => {
      const envOverrides: EnvironmentOverrides = {
        frontend: { domain: 'example.com' },
      };
      const frameworkServices = [{ name: 'frontend', type: 'nextjs' }];

      const result = getFrontendServicesWithDomains(
        envOverrides,
        frameworkServices,
      );

      expect(result).toEqual([
        { name: 'frontend', domain: 'example.com', type: 'cloudrun' },
      ]);
    });

    it('should identify SPA services correctly', () => {
      const envOverrides: EnvironmentOverrides = {
        'admin-app': { domain: 'admin.example.com' },
      };
      const frameworkServices = [{ name: 'admin-app', type: 'spa' }];

      const result = getFrontendServicesWithDomains(
        envOverrides,
        frameworkServices,
      );

      expect(result).toEqual([
        { name: 'admin-app', domain: 'admin.example.com', type: 'spa' },
      ]);
    });

    it('should extract multiple frontend services', () => {
      const envOverrides: EnvironmentOverrides = {
        frontend: { domain: 'example.com' },
        'admin-app': { domain: 'admin.example.com' },
      };
      const frameworkServices = [
        { name: 'frontend', type: 'nextjs' },
        { name: 'admin-app', type: 'spa' },
      ];

      const result = getFrontendServicesWithDomains(
        envOverrides,
        frameworkServices,
      );

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        name: 'frontend',
        domain: 'example.com',
        type: 'cloudrun',
      });
      expect(result).toContainEqual({
        name: 'admin-app',
        domain: 'admin.example.com',
        type: 'spa',
      });
    });
  });

  describe('Filtering behavior', () => {
    it('should skip reserved keys', () => {
      const envOverrides: EnvironmentOverrides = {
        database: { tier: 'small' },
        redis: { tier: 'basic' },
        frontend: { domain: 'example.com' },
      };
      const frameworkServices = [{ name: 'frontend', type: 'nextjs' }];

      const result = getFrontendServicesWithDomains(
        envOverrides,
        frameworkServices,
      );

      expect(result).toEqual([
        { name: 'frontend', domain: 'example.com', type: 'cloudrun' },
      ]);
    });

    it('should skip services without domain', () => {
      const envOverrides: EnvironmentOverrides = {
        'auth-service': { cpu: '2' },
        frontend: { domain: 'example.com' },
      };
      const frameworkServices = [
        { name: 'auth-service', type: 'nestjs' },
        { name: 'frontend', type: 'nextjs' },
      ];

      const result = getFrontendServicesWithDomains(
        envOverrides,
        frameworkServices,
      );

      expect(result).toEqual([
        { name: 'frontend', domain: 'example.com', type: 'cloudrun' },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should return empty array for undefined envOverrides', () => {
      const result = getFrontendServicesWithDomains(undefined, []);
      expect(result).toEqual([]);
    });

    it('should return empty array when no services have domains', () => {
      const envOverrides: EnvironmentOverrides = {
        'auth-service': { cpu: '2' },
      };
      const frameworkServices = [{ name: 'auth-service', type: 'nestjs' }];

      const result = getFrontendServicesWithDomains(
        envOverrides,
        frameworkServices,
      );

      expect(result).toEqual([]);
    });

    it('should default to cloudrun when service not found in framework config', () => {
      const envOverrides: EnvironmentOverrides = {
        'unknown-service': { domain: 'unknown.example.com' },
      };
      const frameworkServices: Array<{ name: string; type?: string }> = [];

      const result = getFrontendServicesWithDomains(
        envOverrides,
        frameworkServices,
      );

      expect(result).toEqual([
        {
          name: 'unknown-service',
          domain: 'unknown.example.com',
          type: 'cloudrun',
        },
      ]);
    });
  });
});
