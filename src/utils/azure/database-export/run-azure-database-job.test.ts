import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockRunAzureDbInit } = rs.hoisted(() => ({
  mockRunAzureDbInit: rs.fn(),
}));

rs.mock('../run-azure-db-init', () => ({ runAzureDbInit: mockRunAzureDbInit }));
rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: () => ({ ARM_CLIENT_ID: 'c' }),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { runAzureDatabaseJob } from './run-azure-database-job';
import type { AzureCommandContext } from '../commands/types';

const context = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const ctx = {
  projectName: 'shop',
  projectRoot: '/p',
  targetEnv: 'dev',
  credentials: { subscriptionId: 's' },
} as unknown as AzureCommandContext;

describe('runAzureDatabaseJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockRunAzureDbInit.mockResolvedValue(undefined);
    context.resolveKeyVaultName.mockResolvedValue('shop-dev-dbjobs');
  });

  describe('Standard use cases', () => {
    it("should run db-init's mode for the one service and its file", async () => {
      await runAzureDatabaseJob({
        ctx,
        mode: 'export',
        serviceName: 'auth-service',
        file: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
      });

      expect(context.resolveKeyVaultName).toHaveBeenCalledWith(
        ctx.credentials,
        'shop',
        'dev',
        'dbjobs',
      );
      expect(mockRunAzureDbInit).toHaveBeenCalledWith({
        mode: 'export',
        exportFile: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
        terraformDir: '/p/infrastructure/terraform/dev',
        tfEnv: { ARM_CLIENT_ID: 'c' },
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
    it("should pass on the job's failure", async () => {
      mockRunAzureDbInit.mockRejectedValue(
        new Error('db-init (restore) failed'),
      );

      await expect(
        runAzureDatabaseJob({
          ctx,
          mode: 'restore',
          serviceName: 'auth-service',
          file: 'f',
        }),
      ).rejects.toThrow('db-init (restore) failed');
    });
  });
});
