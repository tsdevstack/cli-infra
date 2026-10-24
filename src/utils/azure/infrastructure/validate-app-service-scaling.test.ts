import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateAppServiceScaling } from './validate-app-service-scaling';

const serviceTypes = new Map<string, string | undefined>([
  ['auth-service', 'nestjs'],
  ['frontend', 'nextjs'],
  ['admin', 'nextjs'],
  ['react-app', 'spa'],
]);

const validate = (overrides: Record<string, unknown>): void =>
  validateAppServiceScaling('dev', overrides, serviceTypes);

describe('validateAppServiceScaling', () => {
  describe('Accepted configs', () => {
    it('should accept an environment without App Service settings', () => {
      expect(() => validate({})).not.toThrow();
      expect(() =>
        validate({ 'auth-service': { minInstances: 0, cpu: '1' } }),
      ).not.toThrow();
    });

    it('should accept a fixed count on a Basic plan', () => {
      expect(() =>
        validate({ kong: { minInstances: 2, maxInstances: 2 } }),
      ).not.toThrow();
      expect(() =>
        validate({ frontend: { minInstances: 3 }, admin: { minInstances: 2 } }),
      ).not.toThrow();
    });

    it('should accept autoscale on Standard and Premium plans', () => {
      expect(() =>
        validate({
          appService: { kongSku: 'S1', nextjsSku: 'P1v3' },
          kong: { minInstances: 1, maxInstances: 10 },
          frontend: { minInstances: 2, maxInstances: 30 },
        }),
      ).not.toThrow();
    });

    it('should accept minInstances 0 (the plan runs one instance)', () => {
      expect(() => validate({ kong: { minInstances: 0 } })).not.toThrow();
      expect(() =>
        validate({ frontend: { minInstances: 0, maxInstances: 1 } }),
      ).not.toThrow();
    });

    it('should accept a default maxInstances above the count on a Basic plan', () => {
      // The defaults (max 5) are reported by infra:generate, not rejected
      expect(() => validate({ kong: { minInstances: 1 } })).not.toThrow();
      expect(() => validate({ kong: { maxUploadSize: '50m' } })).not.toThrow();
    });
  });

  describe('appService', () => {
    it('should reject an unknown field', () => {
      expect(() => validate({ appService: { kongSize: 'S1' } })).toThrow(
        'Unknown field "kongSize" in dev.appService',
      );
    });

    it('should reject an unknown SKU', () => {
      expect(() => validate({ appService: { nextjsSku: 'P1v2' } })).toThrow(
        mocks.CliError,
      );
      expect(() => validate({ appService: { nextjsSku: 'P1v2' } })).toThrow(
        'dev.appService.nextjsSku',
      );
    });
  });

  describe('Settings App Service cannot honour', () => {
    it('should reject cpu and memory on Kong, naming the SKU', () => {
      expect(() => validate({ kong: { cpu: '1' } })).toThrow(
        'dev.kong.cpu has no effect on Azure: Kong runs on App Service, where appService.kongSku sets the size',
      );
      expect(() => validate({ kong: { memory: '2Gi' } })).toThrow(
        'dev.kong.memory has no effect on Azure',
      );
    });

    it('should reject cpu and memory on a Next.js app', () => {
      expect(() => validate({ frontend: { cpu: '1' } })).toThrow(
        'dev.frontend.cpu has no effect on Azure: Next.js apps run on App Service, where appService.nextjsSku sets the size',
      );
    });

    it('should reject a count above the tier limit', () => {
      expect(() => validate({ kong: { minInstances: 4 } })).toThrow(
        'dev.kong.minInstances: 4 is above the Basic limit of 3 instances (appService.kongSku B1)',
      );
      expect(() =>
        validate({
          appService: { nextjsSku: 'S2' },
          admin: { maxInstances: 11 },
        }),
      ).toThrow(
        'dev.admin.maxInstances: 11 is above the Standard limit of 10 instances (appService.nextjsSku S2)',
      );
      expect(() =>
        validate({
          appService: { kongSku: 'P3v3' },
          kong: { maxInstances: 31 },
        }),
      ).toThrow('above the Premium limit of 30');
    });

    it('should reject an explicit maxInstances above the count on a Basic plan', () => {
      expect(() =>
        validate({ kong: { minInstances: 1, maxInstances: 3 } }),
      ).toThrow(
        'dev.kong.maxInstances: 3 is above minInstances (1) on a Basic plan (appService.kongSku B1), which cannot autoscale',
      );
      expect(() => validate({ frontend: { maxInstances: 2 } })).toThrow(
        'dev.frontend.maxInstances: 2 is above minInstances (1) on a Basic plan (appService.nextjsSku B1)',
      );
    });

    it('should hint at S1 or a fixed count on a Basic plan', () => {
      try {
        validate({ kong: { maxInstances: 2 } });
        throw new Error('expected a CliError');
      } catch (error) {
        expect((error as { hint?: string }).hint).toBe(
          'Set appService.kongSku to S1 or higher for CPU autoscale, or set maxInstances to 1 for a fixed count',
        );
      }
    });
  });
});
