/**
 * Tests for delete-storage-account
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockDelete = rs.fn();

// Mock buildRuntime
rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

// Mock infra-core
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

// Mock Azure Storage Management client
rs.mock('@azure/arm-storage', () => ({
  StorageManagementClient: class MockStorageManagementClient {
    storageAccounts = {
      delete: mockDelete,
    };
    constructor() {}
  },
}));

import { deleteStorageAccount } from './delete-storage-account';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

describe('deleteStorageAccount', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return success when Storage Account is deleted', async () => {
      mockDelete.mockResolvedValue({});

      const result = await deleteStorageAccount({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        storageAccountName: 'teststorage',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockDelete).toHaveBeenCalledWith('test-rg', 'teststorage');
    });
  });

  describe('Not found / already deleted', () => {
    it('should return success with deleted false when Storage Account not found', async () => {
      const error = new Error('Not found') as Error & { statusCode: number };
      error.statusCode = 404;
      mockDelete.mockRejectedValue(error);

      const result = await deleteStorageAccount({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        storageAccountName: 'teststorage',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Error cases', () => {
    it('should return failure on API error', async () => {
      mockDelete.mockRejectedValue(new Error('Access denied'));

      const result = await deleteStorageAccount({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        storageAccountName: 'teststorage',
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
