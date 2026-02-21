/**
 * Tests for set-app-service-settings
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

const mockListApplicationSettings = rs.fn();
const mockUpdateApplicationSettings = rs.fn();

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
      listApplicationSettings: mockListApplicationSettings,
      updateApplicationSettings: mockUpdateApplicationSettings,
    };
    constructor() {}
  },
}));

import { setAppServiceSettings } from './set-app-service-settings';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus',
};

describe('setAppServiceSettings', () => {
  beforeEach(() => {
    rs.resetAllMocks();

    mockListApplicationSettings.mockResolvedValue({
      properties: { EXISTING_KEY: 'existing-value' },
    });
    mockUpdateApplicationSettings.mockResolvedValue({});
  });

  describe('Standard use cases', () => {
    it('should merge new settings with existing settings', async () => {
      await setAppServiceSettings(
        testCredentials,
        'my-app-dev-rg',
        'my-app-frontend',
        {
          NODE_ENV: 'production',
          API_URL: 'https://api.example.com',
        },
      );

      expect(mockUpdateApplicationSettings).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'my-app-frontend',
        {
          properties: {
            EXISTING_KEY: 'existing-value',
            NODE_ENV: 'production',
            API_URL: 'https://api.example.com',
          },
        },
      );
    });

    it('should get current settings before updating', async () => {
      await setAppServiceSettings(testCredentials, 'rg', 'app', {
        KEY: 'value',
      });

      expect(mockListApplicationSettings).toHaveBeenCalledWith('rg', 'app');
    });

    it('should override existing settings with same key', async () => {
      mockListApplicationSettings.mockResolvedValue({
        properties: { KEY: 'old-value' },
      });

      await setAppServiceSettings(testCredentials, 'rg', 'app', {
        KEY: 'new-value',
      });

      expect(mockUpdateApplicationSettings).toHaveBeenCalledWith('rg', 'app', {
        properties: {
          KEY: 'new-value',
        },
      });
    });

    it('should handle empty existing settings', async () => {
      mockListApplicationSettings.mockResolvedValue({ properties: {} });

      await setAppServiceSettings(testCredentials, 'rg', 'app', {
        SECRET: 'pa$$word"$(whoami)',
      });

      expect(mockUpdateApplicationSettings).toHaveBeenCalledWith('rg', 'app', {
        properties: {
          SECRET: 'pa$$word"$(whoami)',
        },
      });
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when SDK call fails', async () => {
      mockListApplicationSettings.mockRejectedValue(new Error('Access denied'));

      await expect(
        setAppServiceSettings(testCredentials, 'rg', 'app', { KEY: 'value' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw CliError when update fails', async () => {
      mockUpdateApplicationSettings.mockRejectedValue(
        new Error('Update failed'),
      );

      await expect(
        setAppServiceSettings(testCredentials, 'rg', 'app', { KEY: 'value' }),
      ).rejects.toThrow(mocks.CliError);
    });
  });
});
