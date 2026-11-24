import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const { getToken } = rs.hoisted(() => ({ getToken: rs.fn() }));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: () => ({ getToken }),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

import { refreshKeyVaultReferences } from './refresh-key-vault-references';

const options = {
  credentials: {
    subscriptionId: 'sub-123',
    tenantId: 't',
    clientId: 'c',
    clientSecret: 's',
    location: 'eastus',
  },
  resourceGroupName: 'shop-dev-rg',
  appServiceName: 'shop-dev-kong',
};

describe('refreshKeyVaultReferences', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    getToken.mockResolvedValue({ token: 'token' });
  });

  afterEach(() => {
    rs.unstubAllGlobals();
  });

  describe('Standard use cases', () => {
    it("should ask App Service to read the app's references again", async () => {
      const fetchMock = rs.fn().mockResolvedValue({ ok: true, status: 200 });
      rs.stubGlobal('fetch', fetchMock);

      await refreshKeyVaultReferences(options);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://management.azure.com/subscriptions/sub-123/resourceGroups/shop-dev-rg/providers/Microsoft.Web/sites/shop-dev-kong/config/configreferences/appsettings/refresh?api-version=2022-03-01',
        { method: 'POST', headers: { Authorization: 'Bearer token' } },
      );
    });

    it('should accept an answer that the refresh runs later', async () => {
      rs.stubGlobal(
        'fetch',
        rs.fn().mockResolvedValue({ ok: true, status: 202 }),
      );

      await expect(refreshKeyVaultReferences(options)).resolves.toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it("should throw with Azure's status and answer when it refuses", async () => {
      rs.stubGlobal(
        'fetch',
        rs.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: async () => '{"error":{"code":"NotFound"}}',
        }),
      );

      await expect(refreshKeyVaultReferences(options)).rejects.toThrow(
        'HTTP 404: {"error":{"code":"NotFound"}}',
      );
    });

    it('should throw when there is no access token', async () => {
      getToken.mockResolvedValue(null);
      const fetchMock = rs.fn();
      rs.stubGlobal('fetch', fetchMock);

      await expect(refreshKeyVaultReferences(options)).rejects.toThrow(
        'Could not get an Azure access token',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
