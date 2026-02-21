/**
 * Tests for delete-shared-secrets-for-service
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteSharedSecretsForService } from './delete-shared-secrets-for-service';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  DeleteSecretCommand: rs.fn(),
}));

// Mock dependencies
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    logger: {
      warn: rs.fn(),
    },
  })),
}));

rs.mock('@tsdevstack/infra-core', () => ({
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

describe('deleteSharedSecretsForService', () => {
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
    it('should delete URL and API_KEY secrets for service', async () => {
      mockSend.mockResolvedValue({});

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: false,
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted.length).toBeGreaterThan(0);
    });

    it('should handle ResourceNotFoundException as already gone', async () => {
      const error = new Error('Resource not found');
      (error as Error & { name: string }).name = 'ResourceNotFoundException';
      mockSend.mockRejectedValue(error);

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: false,
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.alreadyGone.length).toBeGreaterThan(0);
    });

    it('should include database secrets when hasDatabase is true', async () => {
      mockSend.mockResolvedValue({});

      const result = await deleteSharedSecretsForService({
        projectName: 'test-project',
        serviceName: 'auth-service',
        hasDatabase: true,
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      // Should attempt to delete more secrets (URL, API_KEY, DB_PASSWORD, DB_USERNAME)
      expect(
        result.deleted.length + result.alreadyGone.length,
      ).toBeGreaterThanOrEqual(2);
    });
  });
});
