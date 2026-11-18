import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockGet = rs.fn();
const mockDelete = rs.fn();

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('@azure/arm-locks', () => ({
  ManagementLockClient: class {
    managementLocks = {
      getAtResourceLevel: mockGet,
      deleteAtResourceLevel: mockDelete,
    };
  },
}));

import { liftDatabaseLock } from './lift-database-lock';

const target = {
  credentials: {
    subscriptionId: 'sub-123',
    tenantId: 't',
    clientId: 'c',
    clientSecret: 's',
    location: 'eastus',
  },
  resourceGroupName: 'my-app-dev-rg',
  serverName: 'my-app-dev-postgres',
};

const LOCK = [
  'my-app-dev-rg',
  'Microsoft.DBforPostgreSQL',
  '',
  'flexibleServers',
  'my-app-dev-postgres',
  'tsdevstack-database-delete-lock',
];

describe('liftDatabaseLock', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should delete the lock and say it was on', async () => {
      mockGet.mockResolvedValue({ level: 'CanNotDelete' });
      mockDelete.mockResolvedValue(undefined);

      await expect(liftDatabaseLock(target)).resolves.toBe(true);
      expect(mockGet).toHaveBeenCalledWith(...LOCK);
      expect(mockDelete).toHaveBeenCalledWith(...LOCK);
    });

    it('should say there was none when Azure has no such lock', async () => {
      mockGet.mockRejectedValue(
        Object.assign(new Error('LockNotFound'), { statusCode: 404 }),
      );

      await expect(liftDatabaseLock(target)).resolves.toBe(false);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should pass on a refused read', async () => {
      mockGet.mockRejectedValue(
        Object.assign(new Error('AuthorizationFailed'), { statusCode: 403 }),
      );

      await expect(liftDatabaseLock(target)).rejects.toThrow(
        'AuthorizationFailed',
      );
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should pass on a refused delete', async () => {
      mockGet.mockResolvedValue({ level: 'CanNotDelete' });
      mockDelete.mockRejectedValue(
        Object.assign(new Error('AuthorizationFailed'), { statusCode: 403 }),
      );

      await expect(liftDatabaseLock(target)).rejects.toThrow(
        'AuthorizationFailed',
      );
    });
  });
});
