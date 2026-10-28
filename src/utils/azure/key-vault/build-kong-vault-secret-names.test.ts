import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { buildKongVaultSecretNames } from './build-kong-vault-secret-names';

describe('buildKongVaultSecretNames', () => {
  describe('Standard use cases', () => {
    it("should name each of Kong's runtime secrets as the shared vault stores it", () => {
      expect(buildKongVaultSecretNames('shop')).toEqual([
        { key: 'REDIS_PASSWORD', secretName: 'shop-shared-REDIS-PASSWORD' },
        { key: 'KONG_TRUST_TOKEN', secretName: 'shop-shared-KONG-TRUST-TOKEN' },
        {
          key: 'KONG_FRONTEND_TOKEN',
          secretName: 'shop-shared-KONG-FRONTEND-TOKEN',
        },
      ]);
    });
  });
});
