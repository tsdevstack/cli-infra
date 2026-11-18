import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockWrite, mockBuildAndPush, mockRun, mockGetTerraformOutput, calls } =
  rs.hoisted(() => {
    const calls: string[] = [];
    return {
      calls,
      mockWrite: rs.fn(async () => {
        calls.push('admin password');
        return true;
      }),
      mockBuildAndPush: rs.fn(async () => {
        calls.push('build');
        return 'image';
      }),
      mockRun: rs.fn(async () => {
        calls.push('run');
      }),
      mockGetTerraformOutput: rs.fn(),
    };
  });

rs.mock('./key-vault/write-key-vault-secret', () => ({
  writeKeyVaultSecret: mockWrite,
}));
rs.mock('./build-and-push-azure-db-init', () => ({
  buildAndPushAzureDbInit: mockBuildAndPush,
}));
rs.mock('./run-azure-db-init', () => ({ runAzureDbInit: mockRun }));
rs.mock('./terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { setUpAzureDatabaseUsers } from './set-up-azure-database-users';

const credentials = {
  subscriptionId: 's',
  tenantId: 't',
  clientId: 'c',
  clientSecret: 'x',
  location: 'swedencentral',
};

const options = {
  terraformDir: '/p/infrastructure/terraform/dev',
  tfEnv: {},
  projectName: 'shop',
  targetEnv: 'dev',
  credentials,
  serviceNames: ['auth-service'],
  dbJobsKeyVault: 'shop-dev-dbjobs',
  serviceKeyVaults: { 'auth-service': 'shop-dev-auth-service' },
};

describe('setUpAzureDatabaseUsers', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    calls.length = 0;
    mockGetTerraformOutput.mockImplementation((_dir: string, name: string) =>
      name === 'database_admin_password' ? 'admin-pw' : 'shopdevacr.azurecr.io',
    );
  });

  describe('Standard use cases', () => {
    it("should keep the admin password in the database jobs' vault, then push and run db-init", async () => {
      await setUpAzureDatabaseUsers(options);

      expect(calls).toEqual(['admin password', 'build', 'run']);
      expect(mockWrite).toHaveBeenCalledWith({
        credentials,
        vaultName: 'shop-dev-dbjobs',
        secretName: 'db-admin-password',
        value: 'admin-pw',
      });
      expect(mockBuildAndPush).toHaveBeenCalledWith({
        dbInitDir: '/p/infrastructure/terraform/dev/db-init',
        acrLoginServer: 'shopdevacr.azurecr.io',
        credentials,
      });
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'init',
          serviceNames: ['auth-service'],
          dbJobsKeyVault: 'shop-dev-dbjobs',
          serviceKeyVaults: { 'auth-service': 'shop-dev-auth-service' },
        }),
      );
    });
  });

  describe('Edge cases', () => {
    it('should not run db-init when the admin password cannot be stored', async () => {
      mockWrite.mockRejectedValueOnce(new Error('Forbidden'));

      await expect(setUpAzureDatabaseUsers(options)).rejects.toThrow(
        'Forbidden',
      );
      expect(mockRun).not.toHaveBeenCalled();
    });
  });
});
