/**
 * Tests for delete-container-app-job
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';

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
    jobs = {
      beginDeleteAndWait: mockBeginDeleteAndWait,
    };
    constructor() {}
  },
}));

import { deleteContainerAppJob } from './delete-container-app-job';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

describe('deleteContainerAppJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return success when Container App Job is deleted', async () => {
      mockBeginDeleteAndWait.mockResolvedValue({});

      const result = await deleteContainerAppJob({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        jobName: 'test-job',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockBeginDeleteAndWait).toHaveBeenCalledWith(
        'test-rg',
        'test-job',
      );
    });
  });

  describe('Not found / already deleted', () => {
    it('should return success with deleted false when job not found', async () => {
      const error = new Error('Not found') as Error & { statusCode: number };
      error.statusCode = 404;
      mockBeginDeleteAndWait.mockRejectedValue(error);

      const result = await deleteContainerAppJob({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        jobName: 'test-job',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Error cases', () => {
    it('should return failure on API error', async () => {
      mockBeginDeleteAndWait.mockRejectedValue(new Error('Access denied'));

      const result = await deleteContainerAppJob({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        jobName: 'test-job',
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
