import { describe, it, expect, rs, afterEach } from '@rstest/core';
import { fetchArmList } from './fetch-arm-list';

describe('fetchArmList', () => {
  afterEach(() => {
    rs.unstubAllGlobals();
  });

  describe('Standard use cases', () => {
    it('should read every page by following nextLink', async () => {
      const fetchMock = rs
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            value: [1, 2],
            nextLink: 'https://next?page=2',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ value: [3] }),
        });
      rs.stubGlobal('fetch', fetchMock);

      expect(await fetchArmList<number>('https://first?x=1', 'token')).toEqual([
        1, 2, 3,
      ]);
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://first?x=1', {
        headers: { Authorization: 'Bearer token' },
      });
      expect(fetchMock.mock.calls[1][0]).toBe('https://next?page=2');
    });
  });

  describe('Edge cases', () => {
    it('should throw on an error status, without the query string', async () => {
      rs.stubGlobal(
        'fetch',
        rs.fn().mockResolvedValue({ ok: false, status: 403 }),
      );

      await expect(
        fetchArmList('https://management.azure.com/zones?api-version=1', 't'),
      ).rejects.toThrow('HTTP 403 from https://management.azure.com/zones');
    });
  });
});
