import { describe, it, expect } from '@rstest/core';
import { buildKeyVaultSecretUrl } from './build-key-vault-secret-url';

describe('buildKeyVaultSecretUrl', () => {
  describe('Standard use cases', () => {
    it('should point at the latest version of the secret', () => {
      expect(
        buildKeyVaultSecretUrl(
          'shop-dev-dbjobs',
          'shop-auth-service-MIGRATION-DATABASE-URL',
        ),
      ).toBe(
        'https://shop-dev-dbjobs.vault.azure.net/secrets/shop-auth-service-MIGRATION-DATABASE-URL',
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep a shortened vault name as given', () => {
      expect(buildKeyVaultSecretUrl('my-saas-platf-1a2b3c4d', 's')).toBe(
        'https://my-saas-platf-1a2b3c4d.vault.azure.net/secrets/s',
      );
    });
  });
});
