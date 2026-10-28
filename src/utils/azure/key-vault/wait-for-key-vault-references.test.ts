import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { getReference, restart } = rs.hoisted(() => ({
  getReference: rs.fn(),
  restart: rs.fn(),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: class {
    webApps = { getAppSettingKeyVaultReference: getReference, restart };
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: rs.fn(() => ({})) }));

import { waitForKeyVaultReferences } from './wait-for-key-vault-references';

describe('waitForKeyVaultReferences', () => {
  const options = {
    credentials: {
      tenantId: 't',
      clientId: 'c',
      clientSecret: 's',
      subscriptionId: 'sub',
      location: 'eastus',
    },
    resourceGroupName: 'shop-dev-rg',
    appServiceName: 'shop-dev-kong',
    settingNames: ['REDIS_PASSWORD', 'KONG_TRUST_TOKEN'],
    intervalMs: 0,
  };

  /** One status per call, per setting */
  function statuses(...rounds: Array<Record<string, string>>): void {
    let call = 0;
    getReference.mockImplementation(async (_rg, _app, name: string) => {
      const round = rounds[Math.min(Math.floor(call++ / 2), rounds.length - 1)];
      return { status: round[name] };
    });
  }

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return once every reference is resolved', async () => {
      statuses({ REDIS_PASSWORD: 'Resolved', KONG_TRUST_TOKEN: 'Resolved' });

      await waitForKeyVaultReferences(options);

      expect(getReference).toHaveBeenCalledWith(
        'shop-dev-rg',
        'shop-dev-kong',
        'REDIS_PASSWORD',
      );
      expect(restart).not.toHaveBeenCalled();
    });

    it('should restart the app while access is still denied, then return', async () => {
      statuses(
        {
          REDIS_PASSWORD: 'AccessToKeyVaultDenied',
          KONG_TRUST_TOKEN: 'Resolved',
        },
        { REDIS_PASSWORD: 'Resolved', KONG_TRUST_TOKEN: 'Resolved' },
      );

      await waitForKeyVaultReferences(options);

      expect(restart).toHaveBeenCalledTimes(1);
      expect(restart).toHaveBeenCalledWith('shop-dev-rg', 'shop-dev-kong');
    });

    it('should say when every reference has resolved', async () => {
      const { logger } = (
        globalThis as unknown as { contextMocks: MockContext }
      ).contextMocks;
      statuses({ REDIS_PASSWORD: 'Resolved', KONG_TRUST_TOKEN: 'Resolved' });

      await waitForKeyVaultReferences(options);

      expect(logger.success).toHaveBeenCalledWith(
        '  All 2 Key Vault references resolved',
      );
    });
  });

  describe('Error handling', () => {
    it('should fail at once when a secret does not exist', async () => {
      statuses({
        REDIS_PASSWORD: 'SecretNotFound',
        KONG_TRUST_TOKEN: 'Resolved',
      });

      await expect(waitForKeyVaultReferences(options)).rejects.toThrow(
        'shop-dev-kong: Key Vault references cannot resolve: REDIS_PASSWORD (SecretNotFound)',
      );
      expect(restart).not.toHaveBeenCalled();
    });

    it('should give up when access stays denied', async () => {
      statuses({
        REDIS_PASSWORD: 'AccessToKeyVaultDenied',
        KONG_TRUST_TOKEN: 'AccessToKeyVaultDenied',
      });

      await expect(
        waitForKeyVaultReferences({ ...options, timeoutMs: 0 }),
      ).rejects.toThrow(
        'Key Vault references not resolved after 0 minutes: REDIS_PASSWORD (AccessToKeyVaultDenied), KONG_TRUST_TOKEN (AccessToKeyVaultDenied)',
      );
    });
  });
});
