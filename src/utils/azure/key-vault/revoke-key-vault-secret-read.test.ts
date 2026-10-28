import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { deleteById } = rs.hoisted(() => ({
  deleteById: rs.fn(),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: class {
    resources = { deleteById };
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: rs.fn(() => ({})) }));

import { revokeKeyVaultSecretRead } from './revoke-key-vault-secret-read';
import { buildRoleAssignmentName } from './build-role-assignment-name';

describe('revokeKeyVaultSecretRead', () => {
  const vault =
    '/subscriptions/sub/resourceGroups/shop-dev-rg/providers/Microsoft.KeyVault/vaults/shop-dev-kv';
  const options = {
    credentials: {
      tenantId: 't',
      clientId: 'c',
      clientSecret: 's',
      subscriptionId: 'sub',
      location: 'eastus',
    },
    resourceGroupName: 'shop-dev-rg',
    keyVaultName: 'shop-dev-kv',
    secretNames: ['shop-shared-REDIS-PASSWORD', 'shop-shared-KONG-TRUST-TOKEN'],
    principalId: 'kong-principal',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    deleteById.mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it('should delete the assignment the grant made on each secret', async () => {
      await revokeKeyVaultSecretRead(options);

      expect(deleteById).toHaveBeenCalledTimes(2);
      const scope = `${vault}/secrets/shop-shared-REDIS-PASSWORD`;
      expect(deleteById).toHaveBeenCalledWith(
        `${scope}/providers/Microsoft.Authorization/roleAssignments/${buildRoleAssignmentName(scope, 'kong-principal', '4633458b-17de-408a-b874-0445c86b69e6')}`,
        '2022-04-01',
      );
    });
  });

  describe('Edge cases', () => {
    it('should count an assignment that is already gone as removed', async () => {
      deleteById.mockRejectedValueOnce(
        Object.assign(new Error('Not found'), { statusCode: 404 }),
      );

      await expect(revokeKeyVaultSecretRead(options)).resolves.toBeUndefined();
      expect(deleteById).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should fail with the secret named when a delete fails', async () => {
      deleteById.mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      );

      await expect(revokeKeyVaultSecretRead(options)).rejects.toThrow(
        'Failed to remove read access to shop-shared-REDIS-PASSWORD in Key Vault shop-dev-kv: Forbidden',
      );
    });
  });
});
