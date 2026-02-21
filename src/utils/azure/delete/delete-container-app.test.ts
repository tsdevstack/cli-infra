/**
 * Tests for delete-container-app
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockGet = rs.fn();
const mockBeginDeleteAndWait = rs.fn();

// Mock buildRuntime
rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

// Mock infra-core
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

// Mock Azure Container Apps client
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class MockContainerAppsAPIClient {
    containerApps = {
      get: mockGet,
      beginDeleteAndWait: mockBeginDeleteAndWait,
    };
    constructor() {}
  },
}));

import { deleteContainerApp } from './delete-container-app';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

describe('deleteContainerApp', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return success when Container App is deleted', async () => {
      mockGet.mockResolvedValue({});
      mockBeginDeleteAndWait.mockResolvedValue({});

      const result = await deleteContainerApp({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        containerAppName: 'test-app',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockBeginDeleteAndWait).toHaveBeenCalledWith(
        'test-rg',
        'test-app',
      );
    });
  });

  describe('Not found / already deleted', () => {
    it('should return success with deleted false when Container App not found', async () => {
      const error = new Error('Not found') as Error & { statusCode: number };
      error.statusCode = 404;
      mockGet.mockRejectedValue(error);

      const result = await deleteContainerApp({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        containerAppName: 'test-app',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Error cases', () => {
    it('should return failure when existence check fails', async () => {
      mockGet.mockRejectedValue(new Error('Forbidden'));

      const result = await deleteContainerApp({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        containerAppName: 'test-app',
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('Forbidden');
      expect(mockBeginDeleteAndWait).not.toHaveBeenCalled();
    });

    it('should return failure on delete API error', async () => {
      mockGet.mockResolvedValue({});
      mockBeginDeleteAndWait.mockRejectedValue(new Error('Access denied'));

      const result = await deleteContainerApp({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        containerAppName: 'test-app',
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
