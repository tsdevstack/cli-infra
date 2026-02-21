import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { bucketExists } from './bucket-exists';

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  HeadBucketCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'HeadBucketCommand', _params: params };
  }),
}));

// buildAWSClientConfig uses getContext internally
rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
  })),
}));

describe('bucketExists', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    bucketName: 'myproject-frontend-spa',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('bucket existence', () => {
    it('should return exists true when bucket exists', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await bucketExists(baseOptions);
      expect(result.exists).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return exists false when bucket does not exist (NotFound)', async () => {
      const error = new Error('Not Found');
      error.name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      const result = await bucketExists(baseOptions);
      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should return exists false when bucket does not exist (NoSuchBucket)', async () => {
      const error = new Error('No such bucket');
      error.name = 'NoSuchBucket';
      mockSend.mockRejectedValueOnce(error);

      const result = await bucketExists(baseOptions);
      expect(result.exists).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should return error for permission denied', async () => {
      const error = new Error('Access Denied');
      error.name = 'AccessDenied';
      mockSend.mockRejectedValueOnce(error);

      const result = await bucketExists(baseOptions);
      expect(result.exists).toBe(false);
      expect(result.error).toBe('Access Denied');
    });
  });
});
