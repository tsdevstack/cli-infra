import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockCreateOrUpdate = rs.fn();

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('@azure/arm-locks', () => ({
  ManagementLockClient: class {
    managementLocks = { createOrUpdateAtResourceLevel: mockCreateOrUpdate };
  },
}));

import { putDatabaseLock } from './put-database-lock';

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

describe('putDatabaseLock', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should put a CanNotDelete lock on the server', async () => {
      mockCreateOrUpdate.mockResolvedValue({});

      await putDatabaseLock(target);

      expect(mockCreateOrUpdate).toHaveBeenCalledWith(
        'my-app-dev-rg',
        'Microsoft.DBforPostgreSQL',
        '',
        'flexibleServers',
        'my-app-dev-postgres',
        'tsdevstack-database-delete-lock',
        expect.objectContaining({ level: 'CanNotDelete' }),
      );
    });

    it('should keep its notes within the 512 characters Azure takes', async () => {
      mockCreateOrUpdate.mockResolvedValue({});

      await putDatabaseLock(target);

      const { notes } = mockCreateOrUpdate.mock.calls[0][6] as {
        notes: string;
      };
      expect(notes.length).toBeLessThanOrEqual(512);
    });
  });

  describe('Edge cases', () => {
    it('should pass on the error when Azure refuses', async () => {
      mockCreateOrUpdate.mockRejectedValue(
        Object.assign(new Error('AuthorizationFailed'), { statusCode: 403 }),
      );

      await expect(putDatabaseLock(target)).rejects.toThrow(
        'AuthorizationFailed',
      );
    });
  });
});
