import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  CreateInvalidationCommand: rs.fn().mockImplementation(function (
    input: Record<string, unknown>,
  ) {
    return { input };
  }),
}));

import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { invalidateCloudFrontCache } from './invalidate-cloudfront-cache';

const CREDENTIALS = {
  region: 'eu-central-1',
  accessKeyId: 'key-id',
  secretAccessKey: 'secret',
  accountId: '123456789012',
};

interface InvalidationInput {
  DistributionId: string;
  InvalidationBatch: {
    CallerReference: string;
    Paths: { Quantity: number; Items: string[] };
  };
}

function sentInput(): InvalidationInput {
  return (mockSend.mock.calls[0][0] as { input: InvalidationInput }).input;
}

describe('invalidateCloudFrontCache', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    rs.mocked(mocks.isCIEnv).mockReturnValue(false);
    mockSend.mockResolvedValue({});
  });

  describe('Standard use cases', () => {
    it('should clear the whole distribution', async () => {
      const result = await invalidateCloudFrontCache({
        distributionId: 'E1ABCDEF',
        credentials: CREDENTIALS,
      });

      const input = sentInput();
      expect(input.DistributionId).toBe('E1ABCDEF');
      expect(input.InvalidationBatch.Paths).toEqual({
        Quantity: 1,
        Items: ['/*'],
      });
      expect(input.InvalidationBatch.CallerReference).toMatch(
        /^remove-service-\d+$/,
      );
      expect(result).toEqual({ success: true, deleted: true });
    });

    it('should call CloudFront in us-east-1 with the explicit credentials locally', async () => {
      await invalidateCloudFrontCache({
        distributionId: 'E1ABCDEF',
        credentials: CREDENTIALS,
      });

      expect(CloudFrontClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: { accessKeyId: 'key-id', secretAccessKey: 'secret' },
      });
    });
  });

  describe('Edge cases', () => {
    it("should leave the credentials to the SDK's own chain in CI", async () => {
      rs.mocked(mocks.isCIEnv).mockReturnValue(true);

      await invalidateCloudFrontCache({
        distributionId: 'E1ABCDEF',
        credentials: CREDENTIALS,
      });

      expect(CloudFrontClient).toHaveBeenCalledWith({ region: 'us-east-1' });
    });

    it('should clear only the given paths', async () => {
      await invalidateCloudFrontCache({
        distributionId: 'E1ABCDEF',
        paths: ['/index.html'],
        credentials: CREDENTIALS,
      });

      expect(sentInput().InvalidationBatch.Paths).toEqual({
        Quantity: 1,
        Items: ['/index.html'],
      });
    });

    it('should treat a distribution that is gone as nothing to clear', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('gone'), { name: 'NoSuchDistribution' }),
      );

      expect(
        await invalidateCloudFrontCache({
          distributionId: 'E1ABCDEF',
          credentials: CREDENTIALS,
        }),
      ).toEqual({ success: true, deleted: false });
    });

    it("should report any other failure with CloudFront's message", async () => {
      mockSend.mockRejectedValue(new Error('AccessDenied'));

      expect(
        await invalidateCloudFrontCache({
          distributionId: 'E1ABCDEF',
          credentials: CREDENTIALS,
        }),
      ).toEqual({ success: false, deleted: false, error: 'AccessDenied' });
    });
  });
});
