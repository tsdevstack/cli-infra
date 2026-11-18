import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockList, mockDelete } = rs.hoisted(() => ({
  mockList: rs.fn(),
  mockDelete: rs.fn(),
}));

rs.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: class MockGoogleAuth {},
    },
    sqladmin: () => ({ databases: { list: mockList, delete: mockDelete } }),
  },
}));

import { deleteDatabase } from './delete-database';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

const options = {
  databaseName: 'auth-service',
  instanceName: 'shop-postgres',
  projectId: 'shop-dev',
  credentials: {
    project_id: 'shop-dev',
    client_email: 'deployer@shop-dev.iam.gserviceaccount.com',
    private_key: 'key',
  } as unknown as GCPCredentials,
};

describe('deleteDatabase', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockDelete.mockResolvedValue({});
  });

  describe('Standard use cases', () => {
    it('should delete a listed database', async () => {
      mockList.mockResolvedValue({
        data: { items: [{ name: 'postgres' }, { name: 'auth-service' }] },
      });

      await expect(deleteDatabase(options)).resolves.toEqual({
        success: true,
        deleted: true,
      });
      expect(mockDelete).toHaveBeenCalledWith({
        project: 'shop-dev',
        instance: 'shop-postgres',
        database: 'auth-service',
      });
    });

    it("should not call delete for a database that isn't listed (db-init dropped it)", async () => {
      mockList.mockResolvedValue({ data: { items: [{ name: 'postgres' }] } });

      await expect(deleteDatabase(options)).resolves.toEqual({
        success: true,
        deleted: false,
        alreadyGone: true,
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should treat NOT_FOUND as already gone', async () => {
      mockList.mockResolvedValue({
        data: { items: [{ name: 'auth-service' }] },
      });
      mockDelete.mockRejectedValue(
        Object.assign(new Error('Not found'), { code: 404 }),
      );

      await expect(deleteDatabase(options)).resolves.toEqual({
        success: true,
        deleted: false,
        alreadyGone: true,
      });
    });

    it('should report other errors', async () => {
      mockList.mockResolvedValue({
        data: { items: [{ name: 'auth-service' }] },
      });
      mockDelete.mockRejectedValue(
        new Error('must be owner of database auth-service'),
      );

      await expect(deleteDatabase(options)).resolves.toEqual({
        success: false,
        deleted: false,
        error: 'must be owner of database auth-service',
      });
    });
  });
});
