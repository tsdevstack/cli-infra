/**
 * Tests for delete-shared-secrets-for-service
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockBeginDeleteSecret = rs.fn();

// Mock buildRuntime
rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

// Mock Azure Key Vault secrets client
rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class MockSecretClient {
    beginDeleteSecret = mockBeginDeleteSecret;
    constructor() {}
  },
}));

// Mock context
rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    logger: {
      warn: rs.fn(),
    },
  })),
}));

// Mock infra-core (toEnvVarPrefix + createAzureCredential)
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
  toEnvVarPrefix: rs.fn((name: string) =>
    name
      .replace(/-service$/, '')
      .toUpperCase()
      .replace(/-/g, '_'),
  ),
}));

rs.mock('../../string/to-screaming-snake-case', () => ({
  toScreamingSnakeCase: rs.fn((name: string) =>
    name.toUpperCase().replace(/-/g, '_'),
  ),
}));

import { deleteSharedSecretsForService } from './delete-shared-secrets-for-service';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

describe('deleteSharedSecretsForService', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should delete URL and API_KEY secrets for service without database', async () => {
      mockBeginDeleteSecret.mockResolvedValue({});

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: false,
        credentials: testCredentials,
        vaultName: 'test-vault',
      });

      expect(result.success).toBe(true);
      expect(result.deleted.length).toBe(2);
      expect(result.failed.length).toBe(0);
      // URL and API_KEY secrets (hyphens replace underscores in Key Vault)
      expect(result.deleted).toContain('test-project-shared-AUTH-SERVICE-URL');
      expect(result.deleted).toContain(
        'test-project-shared-AUTH-SERVICE-API-KEY',
      );
    });

    it('should include database secrets when hasDatabase is true', async () => {
      mockBeginDeleteSecret.mockResolvedValue({});

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: true,
        credentials: testCredentials,
        vaultName: 'test-vault',
      });

      expect(result.success).toBe(true);
      expect(result.deleted.length).toBe(4);
      expect(result.failed.length).toBe(0);
      // Should include URL, API_KEY, DB_PASSWORD, DB_USERNAME
      expect(result.deleted).toContain('test-project-shared-AUTH-SERVICE-URL');
      expect(result.deleted).toContain(
        'test-project-shared-AUTH-SERVICE-API-KEY',
      );
      expect(result.deleted).toContain('test-project-shared-DB-AUTH-PASSWORD');
      expect(result.deleted).toContain('test-project-shared-DB-AUTH-USERNAME');
    });
  });

  describe('Not found / already deleted', () => {
    it('should handle 404 as already gone', async () => {
      const notFoundError = new Error('Not found') as Error & {
        statusCode: number;
      };
      notFoundError.statusCode = 404;
      mockBeginDeleteSecret.mockRejectedValue(notFoundError);

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: false,
        credentials: testCredentials,
        vaultName: 'test-vault',
      });

      expect(result.success).toBe(true);
      expect(result.deleted.length).toBe(0);
      expect(result.alreadyGone.length).toBe(2);
      expect(result.failed.length).toBe(0);
    });

    it('should handle mixed results (some deleted, some already gone)', async () => {
      const notFoundError = new Error('Not found') as Error & {
        statusCode: number;
      };
      notFoundError.statusCode = 404;

      mockBeginDeleteSecret
        .mockResolvedValueOnce({}) // URL deleted
        .mockRejectedValueOnce(notFoundError); // API_KEY already gone

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: false,
        credentials: testCredentials,
        vaultName: 'test-vault',
      });

      expect(result.success).toBe(true);
      expect(result.deleted.length).toBe(1);
      expect(result.alreadyGone.length).toBe(1);
      expect(result.failed.length).toBe(0);
    });
  });

  describe('Error cases', () => {
    it('should report failed secrets on non-404 error', async () => {
      const permError = new Error('Permission denied') as Error & {
        statusCode: number;
      };
      permError.statusCode = 403;
      mockBeginDeleteSecret.mockRejectedValue(permError);

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: false,
        credentials: testCredentials,
        vaultName: 'test-vault',
      });

      expect(result.success).toBe(false);
      expect(result.deleted.length).toBe(0);
      expect(result.failed.length).toBe(2);
      expect(result.error).toBe('Failed to delete 2 secret(s)');
    });
  });
});
