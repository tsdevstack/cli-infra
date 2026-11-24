import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const getApp = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class {
    containerApps = { get: getApp };
  },
}));

import { getDeployedContainerAppImage } from './get-deployed-container-app-image';

const credentials = {
  clientId: 'c',
  clientSecret: 's',
  tenantId: 't',
  subscriptionId: 'sub',
  location: 'swedencentral',
};

describe('getDeployedContainerAppImage', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should return the first container's image", async () => {
    getApp.mockResolvedValue({
      template: { containers: [{ image: 'acr.azurecr.io/auth-service:abc' }] },
    });

    await expect(
      getDeployedContainerAppImage(
        credentials,
        'shop-dev-rg',
        'shop-auth-service',
      ),
    ).resolves.toBe('acr.azurecr.io/auth-service:abc');
    expect(getApp).toHaveBeenCalledWith('shop-dev-rg', 'shop-auth-service');
  });

  it('should return undefined when the app does not exist', async () => {
    getApp.mockRejectedValue({ statusCode: 404 });

    await expect(
      getDeployedContainerAppImage(
        credentials,
        'shop-dev-rg',
        'shop-auth-service',
      ),
    ).resolves.toBeUndefined();
  });

  it('should pass any other error on', async () => {
    getApp.mockRejectedValue(new Error('forbidden'));

    await expect(
      getDeployedContainerAppImage(
        credentials,
        'shop-dev-rg',
        'shop-auth-service',
      ),
    ).rejects.toThrow('forbidden');
  });
});
