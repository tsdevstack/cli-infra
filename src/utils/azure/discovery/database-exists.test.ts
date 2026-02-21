/**
 * Tests for database-exists
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockDatabasesGet = rs.fn();

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

// Mock Azure PostgreSQL Flexible Server client
rs.mock('@azure/arm-postgresql-flexible', () => ({
  PostgreSQLManagementFlexibleServerClient: class MockPostgreSQLManagementFlexibleServerClient {
    databases = {
      get: mockDatabasesGet,
    };
    constructor() {}
  },
}));

import { databaseExists } from './database-exists';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

describe('databaseExists', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return exists true when database is found', async () => {
      mockDatabasesGet.mockResolvedValue({ name: 'test-db' });

      const result = await databaseExists({
        databaseName: 'test-db',
        serverName: 'test-server',
        resourceGroupName: 'test-rg',
        credentials: testCredentials,
      });

      expect(result.exists).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockDatabasesGet).toHaveBeenCalledWith(
        'test-rg',
        'test-server',
        'test-db',
      );
    });
  });

  describe('Not found', () => {
    it('should return exists false when database does not exist (404)', async () => {
      const error = new Error('Not found') as Error & { statusCode: number };
      error.statusCode = 404;
      mockDatabasesGet.mockRejectedValue(error);

      const result = await databaseExists({
        databaseName: 'nonexistent-db',
        serverName: 'test-server',
        resourceGroupName: 'test-rg',
        credentials: testCredentials,
      });

      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Error cases', () => {
    it('should return exists false with error on API failure', async () => {
      mockDatabasesGet.mockRejectedValue(new Error('Access denied'));

      const result = await databaseExists({
        databaseName: 'test-db',
        serverName: 'test-server',
        resourceGroupName: 'test-rg',
        credentials: testCredentials,
      });

      expect(result.exists).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
