import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mocks = rs.hoisted(() => ({
  listKeys: rs.fn(),
  listBlobsFlat: rs.fn(),
  containerClient: rs.fn(),
  sharedKey: rs.fn(),
}));

rs.mock('@azure/arm-storage', () => ({
  StorageManagementClient: class {
    storageAccounts = { listKeys: mocks.listKeys };
  },
}));
rs.mock('@azure/storage-blob', () => ({
  ContainerClient: class {
    constructor(...args: unknown[]) {
      mocks.containerClient(...args);
    }
    listBlobsFlat = mocks.listBlobsFlat;
  },
  StorageSharedKeyCredential: class {
    constructor(...args: unknown[]) {
      mocks.sharedKey(...args);
    }
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: () => ({}),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

import { listAzureDbExports } from './list-azure-db-exports';

const exports = {
  storageAccount: 'shopdevdbx12b937',
  containerUrl: 'https://shopdevdbx12b937.blob.core.windows.net/db-exports',
};
const blobs = (...items: Array<[string, number]>) => ({
  async *[Symbol.asyncIterator]() {
    for (const [name, contentLength] of items) {
      yield { name, properties: { contentLength } };
    }
  },
});
const list = (serviceName?: string) =>
  listAzureDbExports({
    exports,
    resourceGroupName: 'shop-dev-rg',
    serviceName,
    credentials: { subscriptionId: 's' } as never,
  });

describe('listAzureDbExports', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.listKeys.mockResolvedValue({ keys: [{ value: 'key1' }] });
  });

  describe('Standard use cases', () => {
    it("should list the service's files with the account's key, newest first", async () => {
      mocks.listBlobsFlat.mockReturnValue(
        blobs(
          ['auth-service/2026-11-14T12-30-00Z-removed.dump', 2048],
          ['auth-service/2026-11-14T13-05-00Z-before-restore.dump', 1024],
        ),
      );

      const files = await list('auth-service');

      expect(mocks.listKeys).toHaveBeenCalledWith(
        'shop-dev-rg',
        'shopdevdbx12b937',
      );
      expect(mocks.sharedKey).toHaveBeenCalledWith('shopdevdbx12b937', 'key1');
      expect(mocks.containerClient.mock.calls[0][0]).toBe(exports.containerUrl);
      expect(mocks.listBlobsFlat).toHaveBeenCalledWith({
        prefix: 'auth-service/',
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
  });

  describe('Edge cases', () => {
    it('should list every service without one, and leave out other names', async () => {
      mocks.listBlobsFlat.mockReturnValue(
        blobs(
          ['auth-service/2026-11-14T12-30-00Z-removed.dump', 2],
          ['notes.txt', 1],
          ['offers-service/2026-11-14T13-00-00Z-removed.dump', 3],
        ),
      );

      const files = await list();

      expect(mocks.listBlobsFlat).toHaveBeenCalledWith({});
      expect(files.map((f) => f.serviceName)).toEqual([
        'offers-service',
        'auth-service',
      ]);
    });

    it('should fail without a key to read with', async () => {
      mocks.listKeys.mockResolvedValue({ keys: [] });

      await expect(list('auth-service')).rejects.toThrow(
        'No key for the storage account shopdevdbx12b937',
      );
    });
  });
});
