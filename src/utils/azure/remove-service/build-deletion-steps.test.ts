import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { buildDeletionSteps } from './build-deletion-steps';
import { deleteDatabase } from '../delete';
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
  deleteDatabase: rs.fn().mockResolvedValue({ success: true, deleted: true }),
  deleteKeyVaultSecretsByPrefix: rs
    .fn()
    .mockResolvedValue({ success: true, totalDeleted: 1 }),
  deleteSharedSecretsForService: rs
    .fn()
    .mockResolvedValue({ success: true, deleted: ['secret1'] }),
}));

rs.mock('./sync-terraform-state', () => ({
  syncTerraformState: rs.fn().mockResolvedValue(undefined),
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
  ): ReturnType<typeof buildDeletionSteps> =>
    buildDeletionSteps({
      ctx,
      serviceName: 'auth-service',
      discovered,
      projectName: 'myproject',
      targetEnv: 'dev',
      dbPasswords: {},
      coupledWorkers: [],
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

  describe('Step order', () => {
    it('should delete the database after the container app and before the state sync', () => {
      const steps = build(
        createDiscovery({ containerApp: true, hasDatabase: true }),
      );
      const names = steps.map((s) => s.name);

      expect(names.indexOf('Container App')).toBeLessThan(
        names.indexOf('PostgreSQL database'),
      );
      expect(names.indexOf('PostgreSQL database')).toBeLessThan(
        names.indexOf('Terraform state sync'),
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
});
