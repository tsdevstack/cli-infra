/**
 * Tests for delete-s3-bucket
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteS3Bucket } from './delete-s3-bucket';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListObjectsV2Command: rs.fn(),
  DeleteObjectsCommand: rs.fn(),
  DeleteBucketCommand: rs.fn(),
  NoSuchBucket: class NoSuchBucket extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NoSuchBucket';
    }
  },
}));

// Mock buildAWSClientConfig
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

describe('deleteS3Bucket', () => {
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
    it('should return success false on API error', async () => {
      mockSend.mockRejectedValue(new Error('API error'));

      const result = await deleteS3Bucket({
        bucketName: 'test-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle NoSuchBucket as success', async () => {
      const error = new Error('Bucket not found');
      (error as Error & { name: string }).name = 'NoSuchBucket';
      mockSend.mockRejectedValue(error);

      const result = await deleteS3Bucket({
        bucketName: 'test-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
    });

    it('should handle empty bucket', async () => {
      mockSend
        .mockResolvedValueOnce({ Contents: [] }) // ListObjects
        .mockResolvedValueOnce({}); // DeleteBucket

      const result = await deleteS3Bucket({
        bucketName: 'test-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
    });
  });
});
