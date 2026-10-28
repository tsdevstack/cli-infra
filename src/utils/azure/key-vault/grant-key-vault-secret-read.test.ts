import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { createOrUpdateById } = rs.hoisted(() => ({
  createOrUpdateById: rs.fn(),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: class {
    resources = { createOrUpdateById };
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: rs.fn(() => ({})) }));

import { grantKeyVaultSecretRead } from './grant-key-vault-secret-read';
import { buildRoleAssignmentName } from './build-role-assignment-name';

describe('grantKeyVaultSecretRead', () => {
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
    createOrUpdateById.mockResolvedValue({});
  });

  describe('Standard use cases', () => {
    it('should grant Key Vault Secrets User on each secret, not on the vault', async () => {
      await grantKeyVaultSecretRead(options);

      expect(createOrUpdateById).toHaveBeenCalledTimes(2);
      const scope = `${vault}/secrets/shop-shared-REDIS-PASSWORD`;
      expect(createOrUpdateById).toHaveBeenCalledWith(
        `${scope}/providers/Microsoft.Authorization/roleAssignments/${buildRoleAssignmentName(scope, 'kong-principal', '4633458b-17de-408a-b874-0445c86b69e6')}`,
        '2022-04-01',
        {
          properties: {
            roleDefinitionId:
              '/subscriptions/sub/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6',
            principalId: 'kong-principal',
            principalType: 'ServicePrincipal',
          },
        },
      );
    });
  });

  describe('Edge cases', () => {
    it('should accept a grant that already exists under another name', async () => {
      createOrUpdateById.mockRejectedValueOnce(
        Object.assign(new Error('exists'), { code: 'RoleAssignmentExists' }),
      );

      await expect(grantKeyVaultSecretRead(options)).resolves.toBeUndefined();
      expect(createOrUpdateById).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should fail with the secret named when a grant fails', async () => {
      createOrUpdateById.mockRejectedValueOnce(
        Object.assign(new Error('Not found'), { code: 'ResourceNotFound' }),
      );

      await expect(grantKeyVaultSecretRead(options)).rejects.toThrow(
        'Failed to grant read access to shop-shared-REDIS-PASSWORD in Key Vault shop-dev-kv: Not found',
      );
    });
  });
});
