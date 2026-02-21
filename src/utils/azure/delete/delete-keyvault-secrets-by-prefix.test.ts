/**
 * Tests for delete-keyvault-secrets-by-prefix
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockBeginDeleteSecret = rs.fn();
const mockListPropertiesOfSecrets = rs.fn();

// Mock buildRuntime
rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

// Mock infra-core
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

// Mock Azure Key Vault secrets client
rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class MockSecretClient {
    beginDeleteSecret = mockBeginDeleteSecret;
    listPropertiesOfSecrets = mockListPropertiesOfSecrets;
    constructor() {}
  },
}));

import { deleteKeyVaultSecretsByPrefix } from './delete-keyvault-secrets-by-prefix';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

/**
 * Helper to create an async iterable from an array
 */
function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<T>> {
          if (index < items.length) {
            return { value: items[index++], done: false };
          }
          return { value: undefined as unknown as T, done: true };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}

describe('deleteKeyVaultSecretsByPrefix', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should delete secrets matching the prefix', async () => {
      mockListPropertiesOfSecrets.mockReturnValue(
        createAsyncIterable([
          { name: 'myapp-auth-DB-PASSWORD' },
          { name: 'myapp-auth-DB-USERNAME' },
          { name: 'myapp-offers-DB-PASSWORD' },
        ]),
      );
      mockBeginDeleteSecret.mockResolvedValue({});

      const result = await deleteKeyVaultSecretsByPrefix({
        credentials: testCredentials,
        vaultName: 'test-vault',
        prefix: 'myapp-auth',
      });

      expect(result.success).toBe(true);
      expect(result.totalDeleted).toBe(2);
      expect(mockBeginDeleteSecret).toHaveBeenCalledTimes(2);
      expect(mockBeginDeleteSecret).toHaveBeenCalledWith(
        'myapp-auth-DB-PASSWORD',
      );
      expect(mockBeginDeleteSecret).toHaveBeenCalledWith(
        'myapp-auth-DB-USERNAME',
      );
    });

    it('should return success with zero deleted when no secrets match prefix', async () => {
      mockListPropertiesOfSecrets.mockReturnValue(
        createAsyncIterable([{ name: 'other-prefix-SECRET' }]),
      );

      const result = await deleteKeyVaultSecretsByPrefix({
        credentials: testCredentials,
        vaultName: 'test-vault',
        prefix: 'myapp-auth',
      });

      expect(result.success).toBe(true);
      expect(result.totalDeleted).toBe(0);
      expect(mockBeginDeleteSecret).not.toHaveBeenCalled();
    });

    it('should return success with zero deleted when vault has no secrets', async () => {
      mockListPropertiesOfSecrets.mockReturnValue(createAsyncIterable([]));

      const result = await deleteKeyVaultSecretsByPrefix({
        credentials: testCredentials,
        vaultName: 'test-vault',
        prefix: 'myapp-auth',
      });

      expect(result.success).toBe(true);
      expect(result.totalDeleted).toBe(0);
    });
  });

  describe('Not found / already deleted', () => {
    it('should skip secrets that are already deleted (404) and continue', async () => {
      mockListPropertiesOfSecrets.mockReturnValue(
        createAsyncIterable([
          { name: 'myapp-auth-SECRET-1' },
          { name: 'myapp-auth-SECRET-2' },
        ]),
      );

      const notFoundError = new Error('Not found') as Error & {
        statusCode: number;
      };
      notFoundError.statusCode = 404;

      mockBeginDeleteSecret
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(notFoundError);

      const result = await deleteKeyVaultSecretsByPrefix({
        credentials: testCredentials,
        vaultName: 'test-vault',
        prefix: 'myapp-auth',
      });

      expect(result.success).toBe(true);
      expect(result.totalDeleted).toBe(1);
    });
  });

  describe('Error cases', () => {
    it('should return failure on API error during listing', async () => {
      mockListPropertiesOfSecrets.mockImplementation(() => {
        return {
          [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
            return {
              async next(): Promise<IteratorResult<unknown>> {
                throw new Error('Vault access denied');
              },
              [Symbol.asyncIterator]() {
                return this;
              },
            };
          },
        };
      });

      const result = await deleteKeyVaultSecretsByPrefix({
        credentials: testCredentials,
        vaultName: 'test-vault',
        prefix: 'myapp-auth',
      });

      expect(result.success).toBe(false);
      expect(result.totalDeleted).toBe(0);
      expect(result.error).toBe('Vault access denied');
    });

    it('should return failure on non-404 error during deletion', async () => {
      mockListPropertiesOfSecrets.mockReturnValue(
        createAsyncIterable([{ name: 'myapp-auth-SECRET-1' }]),
      );
      mockBeginDeleteSecret.mockRejectedValue(new Error('Permission denied'));

      const result = await deleteKeyVaultSecretsByPrefix({
        credentials: testCredentials,
        vaultName: 'test-vault',
        prefix: 'myapp-auth',
      });

      expect(result.success).toBe(false);
      expect(result.totalDeleted).toBe(0);
      expect(result.error).toBe('Permission denied');
    });
  });
});
