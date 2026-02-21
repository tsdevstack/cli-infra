/**
 * Tests for delete-secrets-by-prefix
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteSecretsByPrefix } from './delete-secrets-by-prefix';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListSecretsCommand: rs.fn(),
  DeleteSecretCommand: rs.fn(),
}));

// Mock buildAWSClientConfig
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

describe('deleteSecretsByPrefix', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    accountId: '123456789012',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('Standard use cases', () => {
    it('should return success with zero deleted when no secrets found', async () => {
      mockSend.mockResolvedValue({ SecretList: [] });

      const result = await deleteSecretsByPrefix({
        prefix: 'test-prefix-',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.totalDeleted).toBe(0);
    });

    it('should return success false on API error', async () => {
      mockSend.mockRejectedValue(new Error('API error'));

      const result = await deleteSecretsByPrefix({
        prefix: 'test-prefix-',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.totalDeleted).toBe(0);
      expect(result.error).toBeDefined();
    });

    it('should handle ResourceNotFoundException and continue', async () => {
      const error = new Error('Resource not found');
      (error as Error & { name: string }).name = 'ResourceNotFoundException';

      mockSend
        .mockResolvedValueOnce({
          SecretList: [{ Name: 'test-secret-1' }, { Name: 'test-secret-2' }],
        })
        .mockResolvedValueOnce({}) // First delete succeeds
        .mockRejectedValueOnce(error); // Second delete already gone

      const result = await deleteSecretsByPrefix({
        prefix: 'test-prefix-',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.totalDeleted).toBe(1);
    });
  });
});
