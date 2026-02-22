import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateInfrastructureConfig } from './validate-infrastructure-config';
import type { InfrastructureConfig } from './types';

describe('validateInfrastructureConfig', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'test-project' },
      cloud: { provider: 'gcp' },
      services: [
        { name: 'auth-service' },
        { name: 'api-service' },
        { name: 'bff-service' },
      ],
    });
  });

  describe('version validation', () => {
    it('should accept valid config with version 1.0.0', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
        }),
      ).not.toThrow();
    });

    it('should throw for missing version', () => {
      expect(() =>
        validateInfrastructureConfig({} as { version: string }),
      ).toThrow(mocks.CliError);
    });

    it('should throw for unsupported version', () => {
      expect(() => validateInfrastructureConfig({ version: '2.0.0' })).toThrow(
        mocks.CliError,
      );
    });
  });

  describe('$schema handling', () => {
    it('should skip $schema key without treating it as an environment', () => {
      expect(() =>
        validateInfrastructureConfig({
          $schema: './infrastructure.schema.json',
          version: '1.0.0',
          dev: {
            'auth-service': { minInstances: 0 },
          },
        } as unknown as InfrastructureConfig),
      ).not.toThrow();
    });
  });

  describe('environment validation', () => {
    it('should accept valid environment with service overrides', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { minInstances: 1 },
          },
        }),
      ).not.toThrow();
    });

    it('should accept multiple environments', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { 'auth-service': { minInstances: 0 } },
          staging: { 'auth-service': { minInstances: 1 } },
          prod: { 'auth-service': { minInstances: 2 } },
        }),
      ).not.toThrow();
    });

    it('should throw for non-object environment value', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: 'invalid',
        } as unknown as InfrastructureConfig),
      ).toThrow(mocks.CliError);
    });

    it('should throw for null environment value', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: null,
        } as unknown as InfrastructureConfig),
      ).toThrow(mocks.CliError);
    });
  });

  describe('service validation', () => {
    it('should throw for unknown service name', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'unknown-service': { minInstances: 1 },
          },
        }),
      ).toThrow(mocks.CliError);
    });

    it('should include unknown service name in error', () => {
      try {
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'my-unknown-service': { minInstances: 1 },
          },
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('my-unknown-service');
        expect((error as Error).message).toContain('Unknown service');
      }
    });

    it('should accept all valid service names', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { minInstances: 1 },
            'api-service': { minInstances: 2 },
            'bff-service': { minInstances: 0 },
          },
        }),
      ).not.toThrow();
    });

    it('should validate service override fields', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { unknownField: 'value' } as Record<
              string,
              unknown
            >,
          },
        }),
      ).toThrow(mocks.CliError);
    });
  });

  describe('reserved keys', () => {
    it('should accept database key', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            database: { tier: 'db-f1-micro' },
          },
        }),
      ).not.toThrow();
    });

    it('should accept redis key', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            redis: { tier: 'BASIC' },
          },
        }),
      ).not.toThrow();
    });
  });

  describe('mixed services and reserved keys', () => {
    it('should accept config with both services and database/redis', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          prod: {
            database: { tier: 'db-g1-small', ha: true },
            redis: { tier: 'STANDARD_HA' },
            'auth-service': { minInstances: 2, maxInstances: 10 },
            'api-service': { cpu: '2', memory: '1Gi' },
          },
        }),
      ).not.toThrow();
    });
  });

  describe('handles undefined values', () => {
    it('should skip undefined override values', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': undefined,
          },
        } as unknown as InfrastructureConfig),
      ).not.toThrow();
    });
  });
});
