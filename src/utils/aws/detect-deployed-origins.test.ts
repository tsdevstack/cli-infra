import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListObjectsV2Command: rs.fn().mockImplementation(function (params) {
    return { _params: params };
  }),
}));

rs.mock('../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
    logger: { info: rs.fn(), success: rs.fn() },
  })),
}));

import { detectDeployedOrigins } from './detect-deployed-origins';

const credentials = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'example-secret',
  accountId: '123456789012',
};

describe('detectDeployedOrigins', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should look in the bucket Terraform created for the SPA', async () => {
      mockSend.mockResolvedValueOnce({ KeyCount: 1 });

      await detectDeployedOrigins({
        credentials,
        projectName: 'myapp',
        spaServices: ['admin-ui'],
      });

      expect(mockSend).toHaveBeenCalledWith({
        _params: { Bucket: 'myapp-admin-ui-spa-123456789012', MaxKeys: 1 },
      });
    });

    it('should report an SPA with files as ready and an empty one as not', async () => {
      mockSend
        .mockResolvedValueOnce({ KeyCount: 3 })
        .mockResolvedValueOnce({ KeyCount: 0 });

      const result = await detectDeployedOrigins({
        credentials,
        projectName: 'myapp',
        spaServices: ['admin-ui', 'docs-ui'],
      });

      expect(result.spaBucketsReady).toEqual({
        'admin-ui': true,
        'docs-ui': false,
      });
    });
  });

  describe('Edge cases', () => {
    it('should report a missing bucket as not ready', async () => {
      mockSend.mockRejectedValueOnce(new Error('NoSuchBucket'));

      const result = await detectDeployedOrigins({
        credentials,
        projectName: 'myapp',
        spaServices: ['admin-ui'],
      });

      expect(result.spaBucketsReady).toEqual({ 'admin-ui': false });
    });
  });
});
