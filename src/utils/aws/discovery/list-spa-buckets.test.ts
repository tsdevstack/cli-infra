import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { listSpaBuckets } from './list-spa-buckets';

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListBucketsCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'ListBucketsCommand', _params: params };
  }),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
  })),
}));

describe('listSpaBuckets', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    projectName: 'myproject',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('successful listing', () => {
    it('should return empty array when no buckets exist', async () => {
      mockSend.mockResolvedValueOnce({
        Buckets: [],
      });

      const result = await listSpaBuckets(baseOptions);
      expect(result.success).toBe(true);
      expect(result.buckets).toEqual([]);
    });

    it('should filter to SPA buckets only', async () => {
      mockSend.mockResolvedValueOnce({
        Buckets: [
          { Name: 'myproject-frontend-spa' },
          { Name: 'myproject-assets' },
          { Name: 'other-bucket' },
          { Name: 'myproject-admin-spa' },
        ],
      });

      const result = await listSpaBuckets(baseOptions);
      expect(result.success).toBe(true);
      expect(result.buckets).toHaveLength(2);
    });

    it('should extract service name from bucket name', async () => {
      mockSend.mockResolvedValueOnce({
        Buckets: [{ Name: 'myproject-frontend-spa' }],
      });

      const result = await listSpaBuckets(baseOptions);
      expect(result.buckets[0]).toEqual({
        name: 'myproject-frontend-spa',
        serviceName: 'frontend',
      });
    });

    it('should handle hyphenated service names', async () => {
      mockSend.mockResolvedValueOnce({
        Buckets: [{ Name: 'myproject-admin-dashboard-spa' }],
      });

      const result = await listSpaBuckets(baseOptions);
      expect(result.buckets[0].serviceName).toBe('admin-dashboard');
    });
  });

  describe('error handling', () => {
    it('should return error on API failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      const result = await listSpaBuckets(baseOptions);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access Denied');
      expect(result.buckets).toEqual([]);
    });

    it('should handle undefined Buckets', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await listSpaBuckets(baseOptions);
      expect(result.success).toBe(true);
      expect(result.buckets).toEqual([]);
    });
  });
});
