import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockGetSecret, urls } = rs.hoisted(() => ({
  mockGetSecret: rs.fn(),
  urls: [] as string[],
}));

rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    constructor(url: string) {
      urls.push(url);
    }
    getSecret = mockGetSecret;
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

import { readKeyVaultSecret } from './read-key-vault-secret';

const options = {
  credentials: {
    subscriptionId: 's',
    tenantId: 't',
    clientId: 'c',
    clientSecret: 'x',
    location: 'swedencentral',
  },
  vaultName: 'shop-dev-dbjobs',
  secretName: 'shop-auth-service-MIGRATION-DATABASE-URL',
};

describe('readKeyVaultSecret', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    urls.length = 0;
  });

  describe('Standard use cases', () => {
    it("should read the secret's value from the vault", async () => {
      mockGetSecret.mockResolvedValue({ value: 'postgresql://x' });

      await expect(readKeyVaultSecret(options)).resolves.toBe('postgresql://x');
      expect(urls).toEqual(['https://shop-dev-dbjobs.vault.azure.net']);
      expect(mockGetSecret).toHaveBeenCalledWith(
        'shop-auth-service-MIGRATION-DATABASE-URL',
      );
    });
  });

  describe('Edge cases', () => {
    it('should return null for a missing secret', async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('SecretNotFound'), { statusCode: 404 }),
      );

      await expect(readKeyVaultSecret(options)).resolves.toBeNull();
    });

    it('should pass on any other error', async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      );

      await expect(readKeyVaultSecret(options)).rejects.toThrow('Forbidden');
    });
  });
});
