/**
 * Tests for deploy-app-service
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockUpdateConfiguration = rs.fn();
const mockListApplicationSettings = rs.fn();
const mockUpdateApplicationSettings = rs.fn();
const mockRestart = rs.fn();
const mockGet = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('@azure/identity', () => ({
  ClientSecretCredential: class MockClientSecretCredential {
    constructor() {}
  },
}));

rs.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: class MockWebSiteManagementClient {
    webApps = {
      updateConfiguration: mockUpdateConfiguration,
      listApplicationSettings: mockListApplicationSettings,
      updateApplicationSettings: mockUpdateApplicationSettings,
      restart: mockRestart,
      get: mockGet,
    };
    constructor() {}
  },
}));

import { deployAppService } from './deploy-app-service';

const baseParams = {
  credentials: {
    subscriptionId: 'sub-123',
    tenantId: 'tenant-456',
    clientId: 'client-789',
    clientSecret: 'secret-abc',
    location: 'eastus',
  },
  resourceGroupName: 'my-app-dev-rg',
  appServiceName: 'my-app-frontend',
  acrLoginServer: 'myacr.azurecr.io',
  imageUri: 'myacr.azurecr.io/frontend:abc123',
};

describe('deployAppService', () => {
  beforeEach(() => {
    rs.resetAllMocks();

    // Default: all SDK calls succeed, app state is Running
    mockUpdateConfiguration.mockResolvedValue({});
    mockListApplicationSettings.mockResolvedValue({
      properties: { EXISTING_SETTING: 'value' },
    });
    mockUpdateApplicationSettings.mockResolvedValue({});
    mockRestart.mockResolvedValue({});
    mockGet.mockResolvedValue({ state: 'Running' });
  });

  describe('Standard use cases', () => {
    it('should update container image via SDK', async () => {
      await deployAppService(baseParams);

      expect(mockUpdateConfiguration).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'my-app-frontend',
        { linuxFxVersion: 'DOCKER|myacr.azurecr.io/frontend:abc123' },
      );
    });

    it('should merge registry URL into existing app settings', async () => {
      await deployAppService(baseParams);

      expect(mockListApplicationSettings).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'my-app-frontend',
      );
      expect(mockUpdateApplicationSettings).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'my-app-frontend',
        {
          properties: {
            EXISTING_SETTING: 'value',
            DOCKER_REGISTRY_SERVER_URL: 'https://myacr.azurecr.io',
          },
        },
      );
    });

    it('should merge extra app settings, keeping the existing ones', async () => {
      await deployAppService({
        ...baseParams,
        appSettings: { KONG_TRUSTED_IPS: '169.254.0.0/16' },
      });

      expect(mockUpdateApplicationSettings).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'my-app-frontend',
        {
          properties: {
            EXISTING_SETTING: 'value',
            KONG_TRUSTED_IPS: '169.254.0.0/16',
            DOCKER_REGISTRY_SERVER_URL: 'https://myacr.azurecr.io',
          },
        },
      );
    });

    it('should let extra app settings replace an existing value', async () => {
      mockListApplicationSettings.mockResolvedValue({
        properties: { KONG_TRUSTED_IPS: '10.0.0.0/8' },
      });

      await deployAppService({
        ...baseParams,
        appSettings: { KONG_TRUSTED_IPS: '169.254.0.0/16' },
      });

      expect(mockUpdateApplicationSettings).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'my-app-frontend',
        {
          properties: {
            KONG_TRUSTED_IPS: '169.254.0.0/16',
            DOCKER_REGISTRY_SERVER_URL: 'https://myacr.azurecr.io',
          },
        },
      );
    });

    it('should restart the app service', async () => {
      await deployAppService(baseParams);

      expect(mockRestart).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'my-app-frontend',
      );
    });

    it('should verify the app is running', async () => {
      await deployAppService(baseParams);

      expect(mockGet).toHaveBeenCalledWith('my-app-dev-rg', 'my-app-frontend');
    });

    it('should call SDK methods in correct order', async () => {
      const callOrder: string[] = [];
      mockUpdateConfiguration.mockImplementation(async () => {
        callOrder.push('updateConfiguration');
      });
      mockListApplicationSettings.mockImplementation(async () => {
        callOrder.push('listApplicationSettings');
        return { properties: {} };
      });
      mockUpdateApplicationSettings.mockImplementation(async () => {
        callOrder.push('updateApplicationSettings');
      });
      mockRestart.mockImplementation(async () => {
        callOrder.push('restart');
      });
      mockGet.mockImplementation(async () => {
        callOrder.push('get');
        return { state: 'Running' };
      });

      await deployAppService(baseParams);

      expect(callOrder).toEqual([
        'updateConfiguration',
        'listApplicationSettings',
        'updateApplicationSettings',
        'restart',
        'get',
      ]);
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when container config update fails', async () => {
      mockUpdateConfiguration.mockRejectedValue(new Error('Permission denied'));

      await expect(deployAppService(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
      expect(mockRestart).not.toHaveBeenCalled();
    });

    it('should throw CliError when registry URL update fails', async () => {
      mockListApplicationSettings.mockRejectedValue(
        new Error('Settings error'),
      );

      await expect(deployAppService(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
      expect(mockRestart).not.toHaveBeenCalled();
    });

    it('should throw CliError when restart fails', async () => {
      mockRestart.mockRejectedValue(new Error('Restart failed'));

      await expect(deployAppService(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should throw CliError when state is not Running', async () => {
      mockGet.mockResolvedValue({ state: 'Stopped' });

      await expect(deployAppService(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw CliError when get status call fails', async () => {
      mockGet.mockRejectedValue(new Error('Not found'));

      await expect(deployAppService(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });
  });
});
