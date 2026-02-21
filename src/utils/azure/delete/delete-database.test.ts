/**
 * Tests for delete-database
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

// Mock Azure PostgreSQL Flexible Server client
rs.mock('@azure/arm-postgresql-flexible', () => ({
  PostgreSQLManagementFlexibleServerClient: class MockPostgreSQLManagementFlexibleServerClient {
    databases = {
      beginDeleteAndWait: mockBeginDeleteAndWait,
    };
    constructor() {}
  },
}));

import { deleteDatabase } from './delete-database';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

describe('deleteDatabase', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return success when database is deleted', async () => {
      mockBeginDeleteAndWait.mockResolvedValue({});

      const result = await deleteDatabase({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        serverName: 'test-server',
        databaseName: 'test-db',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockBeginDeleteAndWait).toHaveBeenCalledWith(
        'test-rg',
        'test-server',
        'test-db',
      );
    });
  });

  describe('Not found / already deleted', () => {
    it('should return success with deleted false when database not found', async () => {
      const error = new Error('Not found') as Error & { statusCode: number };
      error.statusCode = 404;
      mockBeginDeleteAndWait.mockRejectedValue(error);

      const result = await deleteDatabase({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        serverName: 'test-server',
        databaseName: 'test-db',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Error cases', () => {
    it('should return failure on API error', async () => {
      mockBeginDeleteAndWait.mockRejectedValue(new Error('Access denied'));

      const result = await deleteDatabase({
        credentials: testCredentials,
        resourceGroupName: 'test-rg',
        serverName: 'test-server',
        databaseName: 'test-db',
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
