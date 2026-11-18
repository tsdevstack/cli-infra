import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockSend;
  },
  ListObjectsV2Command: class {
    constructor(public input: unknown) {}
  },
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));

import { listAwsDbExports } from './list-aws-db-exports';

const object = (Key: string, Size: number) => ({ Key, Size });

describe('listAwsDbExports', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should list the service's files, newest first, with their size", async () => {
      mockSend.mockResolvedValue({
        Contents: [
          object('auth-service/2026-11-14T12-30-00Z-removed.dump', 2048),
          object('auth-service/2026-11-14T13-05-00Z-before-restore.dump', 1024),
        ],
      });

      const files = await listAwsDbExports({
        bucket: 'shop-db-exports-123456789012',
        serviceName: 'auth-service',
        credentials: {} as never,
      });

      expect(mockSend.mock.calls[0][0].input).toEqual({
        Bucket: 'shop-db-exports-123456789012',
        Prefix: 'auth-service/',
        ContinuationToken: undefined,
      });
      expect(files.map((f) => [f.name, f.reason, f.size])).toEqual([
        [
          'auth-service/2026-11-14T13-05-00Z-before-restore.dump',
          'before-restore',
          1024,
        ],
        ['auth-service/2026-11-14T12-30-00Z-removed.dump', 'removed', 2048],
      ]);
    });

    it('should read every page of a long list', async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [
            object('auth-service/2026-11-14T12-30-00Z-removed.dump', 1),
          ],
          IsTruncated: true,
          NextContinuationToken: 'next',
        })
        .mockResolvedValueOnce({
          Contents: [
            object('auth-service/2026-11-13T12-30-00Z-removed.dump', 1),
          ],
          IsTruncated: false,
        });

      const files = await listAwsDbExports({
        bucket: 'b',
        serviceName: 'auth-service',
        credentials: {} as never,
      });

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[1][0].input.ContinuationToken).toBe('next');
      expect(files).toHaveLength(2);
    });
  });

  describe('Edge cases', () => {
    it('should leave out files with other names', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          object('auth-service/notes.txt', 1),
          object('auth-service/2026-11-14T12-30-00Z-removed.dump', 2),
        ],
      });

      const files = await listAwsDbExports({
        bucket: 'b',
        serviceName: 'auth-service',
        credentials: {} as never,
      });

      expect(files).toHaveLength(1);
    });

    it('should list every service without one', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          object('auth-service/2026-11-14T12-30-00Z-removed.dump', 2),
          object('offers-service/2026-11-14T13-00-00Z-removed.dump', 3),
        ],
      });

      const files = await listAwsDbExports({
        bucket: 'b',
        credentials: {} as never,
      });

      expect(mockSend.mock.calls[0][0].input.Prefix).toBeUndefined();
      expect(files.map((f) => f.serviceName)).toEqual([
        'offers-service',
        'auth-service',
      ]);
    });

    it('should give an empty list without files', async () => {
      mockSend.mockResolvedValue({});

      expect(
        await listAwsDbExports({
          bucket: 'b',
          serviceName: 'auth-service',
          credentials: {} as never,
        }),
      ).toEqual([]);
    });
  });
});
