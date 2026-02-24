import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockGetProperties = rs.fn();
const mockBeginCreateAndWait = rs.fn();
const mockSetServiceProperties = rs.fn();
const mockBlobContainersGet = rs.fn();
const mockBlobContainersCreate = rs.fn();

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('@azure/arm-storage', () => ({
  StorageManagementClient: class MockStorageManagementClient {
    storageAccounts = {
      getProperties: mockGetProperties,
      beginCreateAndWait: mockBeginCreateAndWait,
    };
    blobServices = {
      setServiceProperties: mockSetServiceProperties,
    };
    blobContainers = {
      get: mockBlobContainersGet,
      create: mockBlobContainersCreate,
    };
    constructor() {}
  },
}));

import { createStateBackend } from './create-state-backend';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

const mockCredentials: AzureCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-sub-id',
  location: 'eastus',
};

describe('createStateBackend', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should create Storage Account and Container when neither exists', async () => {
      mockGetProperties.mockRejectedValue({ statusCode: 404 });
      mockBeginCreateAndWait.mockResolvedValue({});
      mockSetServiceProperties.mockResolvedValue({});
      mockBlobContainersGet.mockRejectedValue({ statusCode: 404 });
      mockBlobContainersCreate.mockResolvedValue({});

      const result = await createStateBackend({
        projectName: 'myproject',
        env: 'dev',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.storageAccountCreated).toBe(true);
      expect(result.containerCreated).toBe(true);
      expect(result.storageAccountName).toBe('myprojectdevtfstate');
      expect(result.containerName).toBe('tfstate');
    });

    it('should skip creation when both already exist', async () => {
      mockGetProperties.mockResolvedValue({ name: 'myprojectdevtfstate' });
      mockBlobContainersGet.mockResolvedValue({ name: 'tfstate' });

      const result = await createStateBackend({
        projectName: 'myproject',
        env: 'dev',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.storageAccountCreated).toBe(false);
      expect(result.containerCreated).toBe(false);
      expect(mockBeginCreateAndWait).not.toHaveBeenCalled();
      expect(mockBlobContainersCreate).not.toHaveBeenCalled();
    });

    it('should strip hyphens from project name in Storage Account name', async () => {
      mockGetProperties.mockResolvedValue({ name: 'exists' });
      mockBlobContainersGet.mockResolvedValue({ name: 'tfstate' });

      const result = await createStateBackend({
        projectName: 'my-project',
        env: 'dev',
        credentials: mockCredentials,
      });

      expect(result.storageAccountName).toBe('myprojectdevtfstate');
    });
  });

  describe('Error handling', () => {
    it('should return error when Storage Account creation fails', async () => {
      mockGetProperties.mockRejectedValue({ statusCode: 404 });
      mockBeginCreateAndWait.mockRejectedValue(new Error('Quota exceeded'));

      const result = await createStateBackend({
        projectName: 'myproject',
        env: 'dev',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Quota exceeded');
    });

    it('should return error when Storage Account check fails with non-404', async () => {
      mockGetProperties.mockRejectedValue({
        statusCode: 403,
        message: 'Forbidden',
      });

      const result = await createStateBackend({
        projectName: 'myproject',
        env: 'dev',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
    });

    it('should return error when Container creation fails', async () => {
      mockGetProperties.mockResolvedValue({ name: 'exists' });
      mockBlobContainersGet.mockRejectedValue({ statusCode: 404 });
      mockBlobContainersCreate.mockRejectedValue(new Error('Container failed'));

      const result = await createStateBackend({
        projectName: 'myproject',
        env: 'dev',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Container failed');
    });
  });
});
