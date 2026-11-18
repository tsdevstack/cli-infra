import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockDeleteByPrefix } = rs.hoisted(() => ({
  mockDeleteByPrefix: rs.fn(),
}));

rs.mock('./delete-keyvault-secrets-by-prefix', () => ({
  deleteKeyVaultSecretsByPrefix: mockDeleteByPrefix,
}));
rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { deleteMigrationDatabaseUrl } from './delete-migration-database-url';

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

describe('deleteMigrationDatabaseUrl', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.keyVaultExists.mockResolvedValue(true);
    mocks.resolveKeyVaultName.mockResolvedValue('shop-dev-dbjobs');
    mockDeleteByPrefix.mockResolvedValue({ success: true, totalDeleted: 1 });
  });

  describe('Standard use cases', () => {
    it("should delete the service's owner URL from the database jobs' vault by its full name", async () => {
      await expect(
        deleteMigrationDatabaseUrl({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({ success: true, deleted: true, error: undefined });

      expect(mockDeleteByPrefix).toHaveBeenCalledWith({
        credentials: ctx.credentials,
        vaultName: 'shop-dev-dbjobs',
        prefix: 'shop-auth-service-MIGRATION-DATABASE-URL',
      });
    });
  });

  describe('Edge cases', () => {
    it('should do nothing without the vault (environment not converted)', async () => {
      mocks.keyVaultExists.mockResolvedValue(false);

      await expect(
        deleteMigrationDatabaseUrl({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({ success: true, deleted: false });
      expect(mockDeleteByPrefix).not.toHaveBeenCalled();
    });
  });
});
