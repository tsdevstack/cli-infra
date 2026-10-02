import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

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

    it('should accept accessControl with noIndex', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          staging: {
            accessControl: { noIndex: true },
          },
        }),
      ).not.toThrow();
    });

    it('should reject accessControl.protected with a removal hint', () => {
      let caught: unknown;
      try {
        validateInfrastructureConfig({
          version: '1.0.0',
          staging: {
            accessControl: { protected: true, noIndex: true },
          },
        } as unknown as InfrastructureConfig);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(mocks.CliError);
      expect((caught as { hint?: string }).hint).toContain(
        'password protection was removed',
      );
    });

    it('should reject accessControl.cookieTtlHours', () => {
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          staging: {
            accessControl: { cookieTtlHours: 24 },
          },
        } as unknown as InfrastructureConfig),
      ).toThrow(mocks.CliError);
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

  describe('provider-aware validation', () => {
    it('should reject Azure-invalid memory when provider is azure', () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'azure' },
        services: [{ name: 'auth-service' }],
      });

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { memory: '512Mi' },
          },
        }),
      ).toThrow(mocks.CliError);
    });

    it('should accept Azure-valid memory when provider is azure', () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'azure' },
        services: [{ name: 'auth-service' }],
      });

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { memory: '2Gi' },
          },
        }),
      ).not.toThrow();
    });

    it('should reject invalid Azure cpu/memory pair', () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'azure' },
        services: [{ name: 'auth-service' }],
      });

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { cpu: '1', memory: '0.5Gi' },
          },
        }),
      ).toThrow(mocks.CliError);
    });

    it('should accept GCP-specific values when provider is gcp', () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'gcp' },
        services: [{ name: 'auth-service' }],
      });

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { cpu: '8', memory: '256Mi' },
          },
        }),
      ).not.toThrow();
    });

    it('should default to gcp when provider is null', () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: null },
        services: [{ name: 'auth-service' }],
      });

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { cpu: '8', memory: '256Mi' },
          },
        }),
      ).not.toThrow();
    });
  });

  describe('minInstances 0 (scale-to-zero) per provider', () => {
    const useProvider = (provider: 'gcp' | 'aws' | 'azure'): void => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider },
        services: [
          { name: 'auth-service', type: 'nestjs' },
          { name: 'frontend', type: 'nextjs' },
          { name: 'react-app', type: 'spa' },
          { name: 'auth-worker', type: 'worker' },
        ],
      });
    };

    it('should reject minInstances 0 for a service on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { 'auth-service': { minInstances: 0 } },
        }),
      ).toThrow('minInstances: 0 is not supported on AWS (dev.auth-service)');
    });

    it('should include a hint to set 1 or more on AWS', () => {
      useProvider('aws');
      try {
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { 'auth-service': { minInstances: 0 } },
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(mocks.CliError);
        expect((error as InstanceType<typeof mocks.CliError>).hint).toContain(
          '1 or more',
        );
      }
    });

    it('should reject minInstances 0 for a Next.js service on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { frontend: { minInstances: 0 } },
        }),
      ).toThrow(mocks.CliError);
    });

    it('should reject minInstances 0 for a worker on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { 'auth-worker': { minInstances: 0 } },
        }),
      ).toThrow(mocks.CliError);
    });

    it('should reject minInstances 0 for Kong on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          staging: { kong: { minInstances: 0 } },
        } as unknown as InfrastructureConfig),
      ).toThrow('minInstances: 0 is not supported on AWS (staging.kong)');
    });

    it('should accept minInstances 1 for services and Kong on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { minInstances: 1 },
            frontend: { minInstances: 2 },
            kong: { minInstances: 1 },
          },
        } as unknown as InfrastructureConfig),
      ).not.toThrow();
    });

    it('should ignore minInstances on SPA services on AWS (served from S3)', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { 'react-app': { minInstances: 0 } },
        }),
      ).not.toThrow();
    });

    it('should allow minInstances 0 for services and Kong on GCP', () => {
      useProvider('gcp');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { minInstances: 0 },
            frontend: { minInstances: 0 },
            kong: { minInstances: 0 },
          },
        } as unknown as InfrastructureConfig),
      ).not.toThrow();
    });

    it('should allow minInstances 0 for services and Kong on Azure', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { minInstances: 0 },
            frontend: { minInstances: 0 },
            kong: { minInstances: 0 },
          },
        } as unknown as InfrastructureConfig),
      ).not.toThrow();
    });
  });

  describe('database.serverName per provider', () => {
    const useProvider = (provider: 'gcp' | 'aws' | 'azure'): void => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider },
        services: [{ name: 'auth-service', type: 'nestjs' }],
      });
    };

    it('should accept a valid serverName on Azure', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { serverName: 'myapp-dev-postgres-2' } },
        }),
      ).not.toThrow();
    });

    it('should accept a database block without serverName on every provider', () => {
      for (const provider of ['gcp', 'aws', 'azure'] as const) {
        useProvider(provider);
        expect(() =>
          validateInfrastructureConfig({
            version: '1.0.0',
            dev: { database: { deletionProtection: false } },
          } as unknown as InfrastructureConfig),
        ).not.toThrow();
      }
    });

    it('should reject serverName on GCP', () => {
      useProvider('gcp');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { serverName: 'myapp-dev-postgres' } },
        }),
      ).toThrow('"database.serverName" is not supported on GCP');
    });

    it('should reject serverName on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          prod: { database: { serverName: 'myapp-prod-postgres' } },
        }),
      ).toThrow('"database.serverName" is not supported on AWS');
    });

    it('should reject an invalid serverName on Azure', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { serverName: 'MyApp_Postgres' } },
        }),
      ).toThrow(mocks.CliError);
    });

    it('should not crash on a null database block', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: null },
        } as unknown as InfrastructureConfig),
      ).not.toThrow();
    });
  });
});
