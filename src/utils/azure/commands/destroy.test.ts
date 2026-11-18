import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  executeTerraform: rs.fn(),
  getTerraformOutput: rs.fn(),
}));

rs.mock('../key-vault/revoke-key-vault-secret-read', () => ({
  revokeKeyVaultSecretRead: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: rs.fn(),
  buildAzureTerraformEnv: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

rs.mock('../delete/delete-environment-container-resources', () => ({
  deleteEnvironmentContainerResources: rs.fn(),
}));

rs.mock('../dns/warn-hand-added-dns-records', () => ({
  warnHandAddedDnsRecords: rs.fn(),
}));

rs.mock('../resolve-postgres-server-name', () => ({
  resolvePostgresServerName: rs.fn(),
}));

rs.mock('../database-lock/lift-database-lock', () => ({
  liftDatabaseLock: rs.fn(),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(),
  },
}));

import fs from 'node:fs';
import inquirer from 'inquirer';
import { azureDestroy } from './destroy';
import { executeTerraform, getTerraformOutput } from '../terraform';
import { revokeKeyVaultSecretRead } from '../key-vault/revoke-key-vault-secret-read';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { deleteEnvironmentContainerResources } from '../delete/delete-environment-container-resources';
import { warnHandAddedDnsRecords } from '../dns/warn-hand-added-dns-records';
import { resolvePostgresServerName } from '../resolve-postgres-server-name';
import { liftDatabaseLock } from '../database-lock/lift-database-lock';

describe('azureDestroy', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      subscriptionId: 'sub-123',
      tenantId: 'tenant-456',
      clientId: 'client-789',
      clientSecret: 'secret-abc',
      location: 'eastus',
    },
    runningInCI: true,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(fs.existsSync).mockReturnValue(true);

    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
      ARM_CLIENT_ID: 'client-789',
      ARM_CLIENT_SECRET: 'secret-abc',
    });

    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });

    rs.mocked(deleteEnvironmentContainerResources).mockResolvedValue({
      deleted: [],
      failed: [],
    });

    rs.mocked(resolvePostgresServerName).mockReturnValue({
      name: 'my-app-dev-postgres',
      isOverride: false,
    });
    rs.mocked(liftDatabaseLock).mockResolvedValue(true);
  });

  describe('database delete lock', () => {
    it('should lift it before anything is deleted', async () => {
      await azureDestroy(mockCtx, { autoApprove: true });

      expect(liftDatabaseLock).toHaveBeenCalledWith({
        credentials: mockCtx.credentials,
        resourceGroupName: 'my-app-dev-rg',
        serverName: 'my-app-dev-postgres',
      });
      const liftOrder = rs.mocked(liftDatabaseLock).mock.invocationCallOrder[0];
      expect(liftOrder).toBeLessThan(
        rs.mocked(deleteEnvironmentContainerResources).mock
          .invocationCallOrder[0],
      );
      expect(liftOrder).toBeLessThan(
        rs.mocked(executeTerraform).mock.invocationCallOrder[0],
      );
    });

    it('should stop with nothing deleted when it cannot be lifted', async () => {
      rs.mocked(liftDatabaseLock).mockRejectedValue(
        new Error('AuthorizationFailed'),
      );

      await expect(
        azureDestroy(mockCtx, { autoApprove: true }),
      ).rejects.toMatchObject({
        name: 'CliError',
        message: expect.stringContaining('AuthorizationFailed'),
        context: 'infra:destroy',
        hint: expect.stringContaining('Nothing was deleted'),
      });
      expect(deleteEnvironmentContainerResources).not.toHaveBeenCalled();
      expect(executeTerraform).not.toHaveBeenCalled();
    });

    it('should go on when there is no lock (a rerun)', async () => {
      rs.mocked(liftDatabaseLock).mockResolvedValue(false);

      await azureDestroy(mockCtx, { autoApprove: true });

      expect(mocks.logger.success).toHaveBeenCalledWith('  No lock on it');
      expect(executeTerraform).toHaveBeenCalledWith(
        'destroy',
        expect.anything(),
      );
    });

    it('should keep it when the destroy is cancelled', async () => {
      rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

      await azureDestroy({ ...mockCtx, runningInCI: false }, {});

      expect(liftDatabaseLock).not.toHaveBeenCalled();
    });
  });

  describe('DNS zone', () => {
    it('should list the hand-added records before asking to go ahead', async () => {
      rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

      await azureDestroy({ ...mockCtx, runningInCI: false }, {});

      expect(warnHandAddedDnsRecords).toHaveBeenCalledWith({
        credentials: mockCtx.credentials,
        resourceGroupName: 'my-app-dev-rg',
        projectName: 'my-app',
        environment: 'dev',
      });
      expect(
        rs.mocked(warnHandAddedDnsRecords).mock.invocationCallOrder[0],
      ).toBeLessThan(rs.mocked(inquirer.prompt).mock.invocationCallOrder[0]);
      expect(executeTerraform).not.toHaveBeenCalled();
    });
  });

  describe('Container Apps created by deploys', () => {
    it('should delete them in the environment before Terraform runs', async () => {
      rs.mocked(deleteEnvironmentContainerResources).mockResolvedValue({
        deleted: ['my-app-auth-service', 'migrate-auth-service'],
        failed: [],
      });

      await azureDestroy(mockCtx, { autoApprove: true });

      expect(deleteEnvironmentContainerResources).toHaveBeenCalledWith({
        credentials: mockCtx.credentials,
        resourceGroupName: 'my-app-dev-rg',
        environmentName: 'my-app-dev-cae',
      });
      expect(
        rs.mocked(deleteEnvironmentContainerResources).mock
          .invocationCallOrder[0],
      ).toBeLessThan(rs.mocked(executeTerraform).mock.invocationCallOrder[0]);
      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Deleted my-app-auth-service',
      );
    });

    it('should stop before Terraform when a delete fails', async () => {
      rs.mocked(deleteEnvironmentContainerResources).mockResolvedValue({
        deleted: [],
        failed: [{ name: 'my-app-bff-service', error: 'Conflict' }],
      });

      await expect(
        azureDestroy(mockCtx, { autoApprove: true }),
      ).rejects.toThrow('Could not delete my-app-bff-service');
      expect(executeTerraform).not.toHaveBeenCalled();
    });
  });

  describe("Kong's grants on its secrets", () => {
    it('should remove them before Terraform destroys Kong', async () => {
      rs.mocked(getTerraformOutput).mockReturnValue('kong-principal');
      rs.mocked(revokeKeyVaultSecretRead).mockResolvedValue(undefined);

      await azureDestroy(mockCtx, { autoApprove: true });

      expect(getTerraformOutput).toHaveBeenCalledWith(
        expect.stringContaining('dev'),
        'kong_principal_id',
        expect.anything(),
      );
      expect(revokeKeyVaultSecretRead).toHaveBeenCalledWith({
        credentials: mockCtx.credentials,
        resourceGroupName: 'my-app-dev-rg',
        keyVaultName: 'my-app-dev-kv',
        secretNames: [
          'my-app-shared-REDIS-PASSWORD',
          'my-app-shared-KONG-TRUST-TOKEN',
          'my-app-shared-KONG-FRONTEND-TOKEN',
        ],
        principalId: 'kong-principal',
      });
      const destroyCall = rs
        .mocked(executeTerraform)
        .mock.calls.findIndex(([command]) => command === 'destroy');
      expect(
        rs.mocked(revokeKeyVaultSecretRead).mock.invocationCallOrder[0],
      ).toBeLessThan(
        rs.mocked(executeTerraform).mock.invocationCallOrder[destroyCall],
      );
    });

    it('should skip them when the state has no Kong', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('Output "kong_principal_id" not found');
      });

      await azureDestroy(mockCtx, { autoApprove: true });

      expect(revokeKeyVaultSecretRead).not.toHaveBeenCalled();
      expect(executeTerraform).toHaveBeenCalledWith(
        'destroy',
        expect.anything(),
      );
    });

    it('should warn and still destroy when removing them fails', async () => {
      rs.mocked(getTerraformOutput).mockReturnValue('kong-principal');
      rs.mocked(revokeKeyVaultSecretRead).mockRejectedValue(
        new Error('Failed to remove read access'),
      );

      await azureDestroy(mockCtx, { autoApprove: true });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Failed to remove read access',
      );
      expect(executeTerraform).toHaveBeenCalledWith(
        'destroy',
        expect.anything(),
      );
    });
  });

  it('should throw when output directory does not exist', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(azureDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should run terraform init and destroy', async () => {
    await azureDestroy(mockCtx, { autoApprove: true });

    expect(executeTerraform).toHaveBeenCalledWith(
      'init',
      expect.objectContaining({ reconfigure: true }),
    );
    expect(executeTerraform).toHaveBeenCalledWith(
      'destroy',
      expect.objectContaining({ autoApprove: true }),
    );
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(azureDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when destroy fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'destroy failed',
      }); // destroy

    await expect(azureDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should prompt for confirmation when not auto-approved', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });

    await azureDestroy({ ...mockCtx, runningInCI: false }, {});

    expect(inquirer.prompt).toHaveBeenCalled();
  });

  it('should abort when user declines confirmation', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

    await azureDestroy({ ...mockCtx, runningInCI: false }, {});

    expect(executeTerraform).not.toHaveBeenCalled();
  });

  it('should log success on completion', async () => {
    await azureDestroy(mockCtx, { autoApprove: true });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Infrastructure destroyed successfully!',
    );
  });
});
