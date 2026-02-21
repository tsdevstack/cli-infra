import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { listSecretsByPrefix } from './list-secrets-by-prefix';

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListSecretsCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'ListSecretsCommand', _params: params };
  }),
}));

// buildAWSClientConfig uses getContext internally
rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
  })),
}));

describe('listSecretsByPrefix', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    prefix: 'myproject-auth-service-',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('successful listing', () => {
    it('should return empty array when no secrets exist', async () => {
      mockSend.mockResolvedValueOnce({
        SecretList: [],
      });

      const result = await listSecretsByPrefix(baseOptions);
      expect(result.success).toBe(true);
      expect(result.secrets).toEqual([]);
    });

    it('should return matching secrets', async () => {
      mockSend.mockResolvedValueOnce({
        SecretList: [
          {
            Name: 'myproject-auth-service-DATABASE_URL',
            ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:myproject-auth-service-DATABASE_URL',
          },
          {
            Name: 'myproject-auth-service-JWT_SECRET',
            ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:myproject-auth-service-JWT_SECRET',
          },
        ],
      });

      const result = await listSecretsByPrefix(baseOptions);
      expect(result.success).toBe(true);
      expect(result.secrets).toHaveLength(2);
      expect(result.secrets[0].name).toBe(
        'myproject-auth-service-DATABASE_URL',
      );
      expect(result.secrets[1].name).toBe('myproject-auth-service-JWT_SECRET');
    });

    it('should handle pagination', async () => {
      mockSend
        .mockResolvedValueOnce({
          SecretList: [
            {
              Name: 'myproject-auth-service-SECRET1',
              ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:myproject-auth-service-SECRET1',
            },
          ],
          NextToken: 'token123',
        })
        .mockResolvedValueOnce({
          SecretList: [
            {
              Name: 'myproject-auth-service-SECRET2',
              ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:myproject-auth-service-SECRET2',
            },
          ],
        });

      const result = await listSecretsByPrefix(baseOptions);
      expect(result.success).toBe(true);
      expect(result.secrets).toHaveLength(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should return error on API failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      const result = await listSecretsByPrefix(baseOptions);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access Denied');
      expect(result.secrets).toEqual([]);
    });

    it('should handle undefined SecretList', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await listSecretsByPrefix(baseOptions);
      expect(result.success).toBe(true);
      expect(result.secrets).toEqual([]);
    });
  });
});
