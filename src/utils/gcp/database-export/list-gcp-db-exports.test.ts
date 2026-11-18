import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockGetFiles, mockBucket } = rs.hoisted(() => {
  const mockGetFiles = rs.fn();
  return {
    mockGetFiles,
    mockBucket: rs.fn(() => ({ getFiles: mockGetFiles })),
  };
});

rs.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket = mockBucket;
  },
}));
rs.mock('../../../context', () => ({
  getContext: () => ({ buildGCPClientOptions: () => ({}) }),
}));

import { listGcpDbExports } from './list-gcp-db-exports';

const object = (name: string, size: string) => ({ name, metadata: { size } });

describe('listGcpDbExports', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should list the service's files, newest first, with their size", async () => {
      mockGetFiles.mockResolvedValue([
        [
          object('auth-service/2026-11-14T12-30-00Z-removed.dump', '2048'),
          object(
            'auth-service/2026-11-14T13-05-00Z-before-restore.dump',
            '1024',
          ),
        ],
      ]);

      const files = await listGcpDbExports({
        bucket: 'shop-db-exports-gcp-shop',
        serviceName: 'auth-service',
        credentials: {} as never,
      });

      expect(mockBucket).toHaveBeenCalledWith('shop-db-exports-gcp-shop');
      expect(mockGetFiles).toHaveBeenCalledWith({ prefix: 'auth-service/' });
      expect(files.map((f) => [f.name, f.reason, f.size])).toEqual([
        [
          'auth-service/2026-11-14T13-05-00Z-before-restore.dump',
          'before-restore',
          1024,
        ],
        ['auth-service/2026-11-14T12-30-00Z-removed.dump', 'removed', 2048],
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should leave out files with other names', async () => {
      mockGetFiles.mockResolvedValue([
        [
          object('auth-service/notes.txt', '1'),
          object('auth-service/2026-11-14T12-30-00Z-removed.dump', '2'),
        ],
      ]);

      const files = await listGcpDbExports({
        bucket: 'b',
        serviceName: 'auth-service',
        credentials: {} as never,
      });

      expect(files).toHaveLength(1);
    });

    it('should list every service without one', async () => {
      mockGetFiles.mockResolvedValue([
        [
          object('auth-service/2026-11-14T12-30-00Z-removed.dump', '2'),
          object('offers-service/2026-11-14T13-00-00Z-removed.dump', '3'),
        ],
      ]);

      const files = await listGcpDbExports({
        bucket: 'b',
        credentials: {} as never,
      });

      expect(mockGetFiles).toHaveBeenCalledWith({});
      expect(files.map((f) => f.serviceName)).toEqual([
        'offers-service',
        'auth-service',
      ]);
    });

    it('should give an empty list without files', async () => {
      mockGetFiles.mockResolvedValue([[]]);

      expect(
        await listGcpDbExports({
          bucket: 'b',
          serviceName: 'auth-service',
          credentials: {} as never,
        }),
      ).toEqual([]);
    });
  });
});
