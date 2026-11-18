import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockRunAzureDbInit, mockGetTerraformOutput } = rs.hoisted(() => ({
  mockRunAzureDbInit: rs.fn(),
  mockGetTerraformOutput: rs.fn(),
}));

rs.mock('../run-azure-db-init', () => ({ runAzureDbInit: mockRunAzureDbInit }));
rs.mock('../terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: () => ({ ARM_SUBSCRIPTION_ID: 's' }),
}));
rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { dropDatabaseRoles } from './drop-database-roles';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const ctx = {
  projectRoot: '/p',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    subscriptionId: 's',
    tenantId: 't',
    clientId: 'c',
    clientSecret: 'x',
    location: 'swedencentral',
  },
  runningInCI: false,
};

describe('dropDatabaseRoles (Azure)', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockGetTerraformOutput.mockReturnValue('/identity/shop-dev-db-jobs');
    mockRunAzureDbInit.mockResolvedValue(undefined);
    mocks.resolveKeyVaultName.mockResolvedValue('shop-dev-dbjobs');
  });

  describe('Standard use cases', () => {
    it("should run db-init's remove mode for the service", async () => {
      await expect(
        dropDatabaseRoles({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({ success: true, deleted: true });

      expect(mockRunAzureDbInit).toHaveBeenCalledWith({
        mode: 'remove',
        terraformDir: '/p/infrastructure/terraform/dev',
        tfEnv: { ARM_SUBSCRIPTION_ID: 's' },
        projectName: 'shop',
        targetEnv: 'dev',
        credentials: ctx.credentials,
        serviceNames: ['auth-service'],
        dbJobsKeyVault: 'shop-dev-dbjobs',
        serviceKeyVaults: {},
      });
    });
  });

  describe('Edge cases', () => {
    it('should skip an environment without db-init (deployed by an older CLI)', async () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Output not found');
      });

      await expect(
        dropDatabaseRoles({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({
        success: true,
        deleted: false,
        error: 'Skipped: no db-init in this environment yet (no app role)',
      });
      expect(mockRunAzureDbInit).not.toHaveBeenCalled();
    });

    it('should report a failed run', async () => {
      mockRunAzureDbInit.mockRejectedValue(
        new Error('db-init (remove) failed'),
      );

      await expect(
        dropDatabaseRoles({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({
        success: false,
        deleted: false,
        error: 'db-init (remove) failed',
      });
    });
  });
});
