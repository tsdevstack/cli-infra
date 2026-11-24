import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { buildDeletionSteps } from './build-deletion-steps';
import {
  deleteContainerAppJob,
  deleteDatabase,
  dropDatabaseRoles,
  deleteMigrationDatabaseUrl,
} from '../delete';
import type { DiscoveredResources } from '../discovery';
import type { AzureCommandContext } from '../commands/types';

// Mock all delete functions (they import Azure SDKs)
rs.mock('../../../context', () => ({
  getContext: () =>
    (globalThis as unknown as { contextMocks: unknown }).contextMocks,
}));

rs.mock('../delete', () => ({
  deleteContainerApp: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteStorageAccount: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteContainerAppJob: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteDatabase: rs.fn().mockResolvedValue({ success: true, deleted: true }),
  deleteKeyVaultSecretsByPrefix: rs
    .fn()
    .mockResolvedValue({ success: true, totalDeleted: 1 }),
  deleteSharedSecretsForService: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: ['secret1'] }),
  dropDatabaseRoles: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
  deleteMigrationDatabaseUrl: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: true }),
}));

describe('buildDeletionSteps (Azure)', () => {
  const credentials = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tenantId: 'test-tenant-id',
    subscriptionId: 'test-subscription-id',
    location: 'eastus2',
  };

  const ctx: AzureCommandContext = {
    projectName: 'myproject',
    projectRoot: '/path/to/project',
    targetEnv: 'dev',
    runningInCI: false,
    credentials,
  };

  const createDiscovery = (
    overrides: Partial<DiscoveredResources> = {},
  ): DiscoveredResources => ({
    containerApp: false,
    vaultName: 'myproject-dev-kv',
    serviceVaultName: 'myproject-dev-auth-service',
    spaBucket: false,
    spaBucketName: '',
    secrets: [],
    serviceVaultSecrets: [],
    inferredType: 'unknown',
    hasDatabase: false,
    postgresServerName: 'myproject-dev-postgres',
    ...overrides,
  });

  const build = (
    discovered: DiscoveredResources,
    saveDatabase?: Parameters<typeof buildDeletionSteps>[0]['saveDatabase'],
  ): ReturnType<typeof buildDeletionSteps> =>
    buildDeletionSteps({
      ctx,
      serviceName: 'auth-service',
      discovered,
      projectName: 'myproject',
      targetEnv: 'dev',
      coupledWorkers: [],
      saveDatabase,
    });

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('PostgreSQL database step', () => {
    it('should not add a database step when the service has no database', () => {
      const steps = build(createDiscovery());

      expect(steps.find((s) => s.name === 'PostgreSQL database')).toBe(
        undefined,
      );
    });

    it('should delete the database on the default server', async () => {
      const steps = build(createDiscovery({ hasDatabase: true }));
      const dbStep = steps.find((s) => s.name === 'PostgreSQL database');

      expect(dbStep?.resource).toBe('auth-service');
      await dbStep?.execute();
      expect(deleteDatabase).toHaveBeenCalledWith({
        credentials,
        resourceGroupName: 'myproject-dev-rg',
        serverName: 'myproject-dev-postgres',
        databaseName: 'auth-service',
      });
    });

    it('should delete the database on the overridden server discovery used', async () => {
      const steps = build(
        createDiscovery({
          hasDatabase: true,
          postgresServerName: 'myproject-dev-pg-2',
        }),
      );
      const dbStep = steps.find((s) => s.name === 'PostgreSQL database');

      await dbStep?.execute();
      expect(deleteDatabase).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: 'myproject-dev-pg-2' }),
      );
    });
  });

  describe('Migration job step', () => {
    it('should delete the migration job of a service with a database', async () => {
      const steps = build(createDiscovery({ hasDatabase: true }));
      const jobStep = steps.find((s) => s.name === 'Migration job');

      expect(jobStep?.resource).toBe('migrate-auth-service');
      await jobStep?.execute();
      expect(deleteContainerAppJob).toHaveBeenCalledWith({
        credentials,
        resourceGroupName: 'myproject-dev-rg',
        jobName: 'migrate-auth-service',
      });
    });

    it('should delete the migration job before the database', () => {
      const names = build(createDiscovery({ hasDatabase: true })).map(
        (s) => s.name,
      );

      expect(names.indexOf('Migration job')).toBeLessThan(
        names.indexOf('PostgreSQL database'),
      );
    });

    it('should not add a migration job step without a database', () => {
      const steps = build(createDiscovery());

      expect(steps.some((s) => s.name === 'Migration job')).toBe(false);
    });
  });

  describe('Database and roles, and migration URL steps', () => {
    it("should drop the service's database and two roles in SQL before the API's database delete", async () => {
      const steps = build(createDiscovery({ hasDatabase: true }));
      const names = steps.map((s) => s.name);
      const rolesStep = steps.find((s) => s.name === 'Database and roles');

      expect(rolesStep?.resource).toBe('auth-service, auth-service_app');
      expect(names.indexOf('Database and roles')).toBeLessThan(
        names.indexOf('PostgreSQL database'),
      );
      await rolesStep?.execute();
      expect(dropDatabaseRoles).toHaveBeenCalledWith({
        ctx,
        serviceName: 'auth-service',
      });
    });

    it("should delete the owner's URL from the database jobs' vault", async () => {
      const steps = build(createDiscovery({ hasDatabase: true }));
      const urlStep = steps.find((s) => s.name === 'Migration URL');

      await urlStep?.execute();
      expect(deleteMigrationDatabaseUrl).toHaveBeenCalledWith({
        ctx,
        serviceName: 'auth-service',
      });
    });

    it('should add neither step without a database', () => {
      const names = build(createDiscovery()).map((s) => s.name);

      expect(names).not.toContain('Database and roles');
      expect(names).not.toContain('Migration URL');
    });
  });

  describe('Database save step', () => {
    it('should save the database right before the drop, after the app and the migration job', async () => {
      const saveDatabase = rs.fn(async () => ({
        success: true,
        deleted: true,
      }));

      const steps = build(
        createDiscovery({ containerApp: true, hasDatabase: true }),
        saveDatabase,
      );

      const names = steps.map((step) => step.name);
      const save = names.indexOf('Database save');
      expect(save).toBeGreaterThan(names.indexOf('Container App'));
      expect(save).toBeGreaterThan(names.indexOf('Migration job'));
      expect(names[save + 1]).toBe('Database and roles');

      const step = steps[save];
      expect(step.label).toBe('Saving the database');
      expect(step.doneText).toBe('Saved');
      await step.execute();
      expect(saveDatabase).toHaveBeenCalledTimes(1);
    });

    it('should not save without a database or with --skip-export', () => {
      const withoutDatabase = build(createDiscovery(), async () => ({
        success: true,
        deleted: true,
      }));
      const skipExport = build(createDiscovery({ hasDatabase: true }));

      for (const steps of [withoutDatabase, skipExport]) {
        expect(steps.some((step) => step.name === 'Database save')).toBe(false);
      }
    });
  });

  describe('Step order', () => {
    it('should delete the database after the container app and before its secrets', () => {
      const steps = build(
        createDiscovery({ containerApp: true, hasDatabase: true }),
      );
      const names = steps.map((s) => s.name);

      expect(names.indexOf('Container App')).toBeLessThan(
        names.indexOf('PostgreSQL database'),
      );
      expect(names.indexOf('PostgreSQL database')).toBeLessThan(
        names.indexOf('Shared secrets for service'),
      );
    });
  });
  describe('Service vault secrets step', () => {
    it("should empty the service's own vault, and keep the vault", () => {
      const steps = build(
        createDiscovery({
          serviceVaultSecrets: ['myproject-auth-service-ADMIN-EMAILS'],
        }),
      );

      const step = steps.find((s) => s.name === 'Service vault secrets');
      expect(step?.resource).toBe('1 secrets');
    });

    it('should also remove what an older environment left in the shared vault', () => {
      const steps = build(
        createDiscovery({
          secrets: ['myproject-auth-service-DATABASE-URL'],
          serviceVaultSecrets: ['myproject-auth-service-ADMIN-EMAILS'],
        }),
      );

      const names = steps.map((s) => s.name);
      expect(names).toContain('Service vault secrets');
      expect(names).toContain('Service-scoped secrets');
    });

    it('should add no vault step when the service has no secrets there', () => {
      const steps = build(createDiscovery());
      expect(steps.map((s) => s.name)).not.toContain('Service vault secrets');
    });
  });
  describe('Cron job steps', () => {
    it("should delete the service's cron jobs first, by their Container App Job names", async () => {
      const steps = buildDeletionSteps({
        ctx,
        serviceName: 'auth-service',
        discovered: createDiscovery(),
        projectName: 'myproject',
        targetEnv: 'dev',
        coupledWorkers: [
          { name: 'auth-worker', containerAppName: 'myproject-auth-worker' },
        ],
        coupledCronJobs: [
          { name: 'usage-report', jobName: 'myproject-cron-usage-report' },
        ],
      });

      expect(steps[0]).toMatchObject({
        name: 'Cron job',
        label: 'Deleting cron job usage-report',
        resource: 'usage-report',
      });
      expect(steps[1]).toMatchObject({
        name: 'Coupled worker',
        resource: 'auth-worker',
      });

      await steps[0].execute();
      expect(deleteContainerAppJob).toHaveBeenCalledWith({
        credentials,
        resourceGroupName: 'myproject-dev-rg',
        jobName: 'myproject-cron-usage-report',
      });
    });

    it('should add no cron job step without cron jobs', () => {
      const steps = build(createDiscovery());
      expect(steps.find((s) => s.name === 'Cron job')).toBeUndefined();
    });
  });
});
