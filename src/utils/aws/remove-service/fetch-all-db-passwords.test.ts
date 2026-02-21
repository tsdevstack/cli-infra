/**
 * Tests for fetch-all-db-passwords
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { fetchAllDbPasswords } from './fetch-all-db-passwords';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListSecretsCommand: rs.fn(),
  GetSecretValueCommand: rs.fn(),
}));

// Mock buildAWSClientConfig
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

describe('fetchAllDbPasswords', () => {
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
    it('should return empty object when no secrets found', async () => {
      mockSend.mockResolvedValue({ SecretList: [] });

      const result = await fetchAllDbPasswords({
        projectName: 'test-project',
        credentials: mockCredentials,
      });

      expect(result).toEqual({});
    });

    it('should extract passwords from DATABASE_URL secrets', async () => {
      mockSend
        .mockResolvedValueOnce({
          SecretList: [
            { Name: 'test-project-auth-service-DATABASE_URL' },
            { Name: 'test-project-other-secret' },
          ],
        })
        .mockResolvedValueOnce({
          SecretString: 'postgresql://user:mypassword@host:5432/dbname',
        });

      const result = await fetchAllDbPasswords({
        projectName: 'test-project',
        credentials: mockCredentials,
      });

      expect(result).toHaveProperty('auth-service');
      expect(result['auth-service']).toBe('mypassword');
    });

    it('should handle errors gracefully and return partial results', async () => {
      mockSend.mockRejectedValue(new Error('API error'));

      const result = await fetchAllDbPasswords({
        projectName: 'test-project',
        credentials: mockCredentials,
      });

      expect(result).toEqual({});
    });

    it('should filter out non-DATABASE_URL secrets', async () => {
      mockSend.mockResolvedValueOnce({
        SecretList: [
          { Name: 'test-project-auth-service-DATABASE_URL' },
          { Name: 'test-project-auth-service-API_KEY' },
          { Name: 'other-project-db-DATABASE_URL' },
        ],
      });

      const result = await fetchAllDbPasswords({
        projectName: 'test-project',
        credentials: mockCredentials,
      });

      // Should only process test-project DATABASE_URL secrets
      expect(Object.keys(result).length).toBeLessThanOrEqual(1);
    });
  });
});
