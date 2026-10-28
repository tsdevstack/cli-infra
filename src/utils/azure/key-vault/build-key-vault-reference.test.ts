import { describe, it, expect } from '@rstest/core';
import { buildKeyVaultReference } from './build-key-vault-reference';

describe('buildKeyVaultReference', () => {
  describe('Standard use cases', () => {
    it('should reference the secret by vault and name', () => {
      expect(
        buildKeyVaultReference('shop-dev-kv', 'shop-shared-REDIS-PASSWORD'),
      ).toBe(
        '@Microsoft.KeyVault(VaultName=shop-dev-kv;SecretName=shop-shared-REDIS-PASSWORD)',
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep a shortened vault name as given', () => {
      expect(buildKeyVaultReference('my-saas-platf-1a2b3c4d', 's')).toContain(
        'VaultName=my-saas-platf-1a2b3c4d;',
      );
    });
  });
});
