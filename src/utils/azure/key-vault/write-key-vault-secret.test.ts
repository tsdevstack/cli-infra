import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockGetSecret, mockSetSecret } = rs.hoisted(() => ({
  mockGetSecret: rs.fn(),
  mockSetSecret: rs.fn(),
}));

rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    getSecret = mockGetSecret;
    setSecret = mockSetSecret;
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
// cli-core's write (its own tests cover recovering a deleted secret)
const { mockSetKeyVaultSecret } = rs.hoisted(() => ({
  mockSetKeyVaultSecret: rs.fn(),
}));
rs.mock('../../../context', () => ({
  getContext: () => ({ setKeyVaultSecret: mockSetKeyVaultSecret }),
}));

import { writeKeyVaultSecret } from './write-key-vault-secret';

const options = {
  credentials: {
    subscriptionId: 's',
    tenantId: 't',
    clientId: 'c',
    clientSecret: 'x',
    location: 'swedencentral',
  },
  vaultName: 'shop-dev-dbjobs',
  secretName: 'db-admin-password',
  value: 'new-pw',
};

describe('writeKeyVaultSecret', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockSetKeyVaultSecret.mockImplementation(
      async (
        client: { setSecret: (name: string, value: string) => unknown },
        name: string,
        value: string,
      ) => {
        await client.setSecret(name, value);
        return { recovered: false };
      },
    );
  });

  describe('Standard use cases', () => {
    it('should write a changed value', async () => {
      mockGetSecret.mockResolvedValue({ value: 'old-pw' });

      await expect(writeKeyVaultSecret(options)).resolves.toBe(true);
      expect(mockSetSecret).toHaveBeenCalledWith('db-admin-password', 'new-pw');
    });

    it("should write through cli-core's write (which recovers a deleted secret)", async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('SecretNotFound'), { statusCode: 404 }),
      );

      await writeKeyVaultSecret(options);

      expect(mockSetKeyVaultSecret).toHaveBeenCalledWith(
        expect.objectContaining({ setSecret: mockSetSecret }),
        'db-admin-password',
        'new-pw',
      );
    });

    it('should write a secret that does not exist yet', async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('SecretNotFound'), { statusCode: 404 }),
      );

      await expect(writeKeyVaultSecret(options)).resolves.toBe(true);
      expect(mockSetSecret).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge cases', () => {
    it('should leave an unchanged value alone (no new version per deploy)', async () => {
      mockGetSecret.mockResolvedValue({ value: 'new-pw' });

      await expect(writeKeyVaultSecret(options)).resolves.toBe(false);
      expect(mockSetSecret).not.toHaveBeenCalled();
    });

    it('should not write when the vault refuses the read', async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      );

      await expect(writeKeyVaultSecret(options)).rejects.toThrow('Forbidden');
      expect(mockSetSecret).not.toHaveBeenCalled();
    });
  });
});
