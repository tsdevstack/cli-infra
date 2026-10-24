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
        services: [{ name: 'auth-service' }, { name: 'offers-service' }],
      });

      // cpu 8 and memory 256Mi are GCP-only values (in pairs Cloud Run accepts)
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: {
            'auth-service': { cpu: '8', memory: '8Gi' },
            'offers-service': { cpu: '1', memory: '256Mi' },
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
            'auth-service': { cpu: '8', memory: '8Gi' },
          },
        }),
      ).not.toThrow();
    });
  });

  describe('database and redis tiers', () => {
    const withProvider = (provider: string): void => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider },
        services: [],
      });
    };

    it('should reject a database tier from another provider', () => {
      withProvider('aws');

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { tier: 'db-f1-micro' } },
        }),
      ).toThrow('dev.database.tier: invalid value "db-f1-micro"');
    });

    it('should accept every tier deploys can size a pool for', () => {
      withProvider('aws');

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { tier: 'db.t4g.micro' } },
          prod: { database: { tier: 'db.r6g.large' } },
        }),
      ).not.toThrow();
    });

    it('should reject a redis tier from another provider', () => {
      withProvider('gcp');

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { redis: { tier: 'cache.t3.micro' } },
        }),
      ).toThrow('dev.redis.tier: invalid value "cache.t3.micro"');
    });

    it('should accept a valid redis tier', () => {
      withProvider('azure');

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { redis: { tier: 'Balanced_B0' } },
        }),
      ).not.toThrow();
    });
  });

  describe('Cloud Run limits (GCP)', () => {
    const gcpWith = (services: { name: string; type?: string }[]): void => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'gcp' },
        services,
      });
    };

    it('should reject cpu below 1 with the default concurrency', () => {
      gcpWith([{ name: 'api', type: 'nestjs' }]);

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { api: { cpu: '0.5' } },
        }),
      ).toThrow(
        'cpu "0.5" needs "concurrency": 1 on Cloud Run (dev.api has 80)',
      );
    });

    it('should accept cpu below 1 with concurrency 1', () => {
      gcpWith([{ name: 'api', type: 'nestjs' }]);

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { api: { cpu: '0.5', concurrency: 1 } },
        }),
      ).not.toThrow();
    });

    it('should reject cpu below 1 for a worker', () => {
      gcpWith([{ name: 'auth-worker', type: 'worker' }]);

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { 'auth-worker': { cpu: '0.5', concurrency: 1 } },
        }),
      ).toThrow('not possible for a worker on Cloud Run');
    });

    it('should check memory against the default cpu', () => {
      gcpWith([{ name: 'api', type: 'nestjs' }]);

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { api: { memory: '8Gi' } },
        }),
      ).toThrow('memory "8Gi" is more than Cloud Run allows with cpu "1"');
    });

    it('should reject cpu below 1 for Kong', () => {
      gcpWith([{ name: 'api', type: 'nestjs' }]);

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { kong: { cpu: '0.5' } },
        }),
      ).toThrow('not possible for Kong on Cloud Run');
    });

    it('should not apply Cloud Run limits on other providers', () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'aws' },
        services: [{ name: 'api', type: 'nestjs' }],
      });

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { api: { cpu: '0.5', memory: '1Gi' } },
        }),
      ).not.toThrow();
    });

    it('should skip SPAs (served from a bucket)', () => {
      gcpWith([{ name: 'web', type: 'spa' }]);

      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { web: { cpu: '0.5' } },
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

  describe('database.diskSize per provider', () => {
    const useProvider = (provider: 'gcp' | 'aws' | 'azure'): void => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider },
        services: [{ name: 'auth-service', type: 'nestjs' }],
      });
    };

    it('should accept 10 GB on GCP', () => {
      useProvider('gcp');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { diskSize: 10 } },
        }),
      ).not.toThrow();
    });

    it('should reject 10 GB on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { diskSize: 10 } },
        }),
      ).toThrow('"database.diskSize" 10 is not supported on AWS');
    });

    it('should reject a size Azure does not offer', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { database: { diskSize: 50 } },
        }),
      ).toThrow('"database.diskSize" 50 is not supported on AZURE');
    });
  });

  describe('database.ha and redis.memoryGb per provider', () => {
    const useProvider = (provider: 'gcp' | 'aws' | 'azure'): void => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider },
        services: [{ name: 'auth-service', type: 'nestjs' }],
      });
    };

    it('should reject ha on the default Azure tier (Burstable)', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          prod: { database: { ha: true } },
        }),
      ).toThrow('Burstable tier "B_Standard_B1ms"');
    });

    it('should accept ha on an Azure General Purpose tier', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          prod: { database: { tier: 'GP_Standard_D2s_v3', ha: true } },
        }),
      ).not.toThrow();
    });

    it('should reject ha with backup false on GCP', () => {
      useProvider('gcp');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          prod: { database: { ha: true, backup: false } },
        }),
      ).toThrow('needs "database.backup" on GCP');
    });

    it('should accept ha on AWS with the default tier', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          prod: { database: { ha: true } },
        }),
      ).not.toThrow();
    });

    it('should reject redis.memoryGb on AWS', () => {
      useProvider('aws');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { redis: { memoryGb: 2 } },
        }),
      ).toThrow('"redis.memoryGb" is not supported on AWS');
    });

    it('should accept redis.memoryGb on GCP', () => {
      useProvider('gcp');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { redis: { memoryGb: 2 } },
        }),
      ).not.toThrow();
    });
  });

  describe('App Service plans on Azure', () => {
    const useProvider = (provider: 'gcp' | 'aws' | 'azure'): void => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider },
        services: [
          { name: 'auth-service', type: 'nestjs' },
          { name: 'frontend', type: 'nextjs' },
        ],
      });
    };

    it('should reject an explicit Kong ceiling on a Basic plan', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { kong: { maxInstances: 3 } },
        }),
      ).toThrow(
        'dev.kong.maxInstances: 3 is above minInstances (1) on a Basic plan',
      );
    });

    it('should reject cpu on a Next.js app on Azure only', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { frontend: { cpu: '1' } },
        }),
      ).toThrow('dev.frontend.cpu has no effect on Azure');

      useProvider('gcp');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { frontend: { cpu: '1' } },
        }),
      ).not.toThrow();
    });

    it('should accept autoscale on a Standard plan', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { appService: { kongSku: 'S1' }, kong: { maxInstances: 3 } },
        }),
      ).not.toThrow();
    });

    it('should reject an unknown App Service SKU', () => {
      useProvider('azure');
      expect(() =>
        validateInfrastructureConfig({
          version: '1.0.0',
          dev: { appService: { kongSku: 'D1' } },
        }),
      ).toThrow('dev.appService.kongSku');
    });
  });
});
