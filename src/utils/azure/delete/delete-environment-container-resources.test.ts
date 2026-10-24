import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const listApps = rs.fn();
const listJobs = rs.fn();
const deleteApp = rs.fn();
const deleteJob = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class {
    containerApps = {
      listByResourceGroup: listApps,
      beginDeleteAndWait: deleteApp,
    };
    jobs = { listByResourceGroup: listJobs, beginDeleteAndWait: deleteJob };
  },
}));

import { deleteEnvironmentContainerResources } from './delete-environment-container-resources';

const ENV_ID =
  '/subscriptions/s/resourceGroups/app-dev-rg/providers/Microsoft.App/managedEnvironments/app-dev-cae';
const OTHER_ENV_ID =
  '/subscriptions/s/resourceGroups/app-dev-rg/providers/Microsoft.App/managedEnvironments/other-cae';

async function* items<T>(list: T[]): AsyncGenerator<T> {
  for (const item of list) yield item;
}

const options = {
  credentials: {
    clientId: 'c',
    clientSecret: 's',
    tenantId: 't',
    subscriptionId: 'sub',
    location: 'swedencentral',
  },
  resourceGroupName: 'app-dev-rg',
  environmentName: 'app-dev-cae',
};

describe('deleteEnvironmentContainerResources', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    deleteApp.mockResolvedValue(undefined);
    deleteJob.mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it('should delete the Container Apps and migration jobs of the environment', async () => {
      listApps.mockReturnValue(
        items([
          { name: 'app-auth-service', managedEnvironmentId: ENV_ID },
          { name: 'app-auth-worker', managedEnvironmentId: ENV_ID },
        ]),
      );
      listJobs.mockReturnValue(
        items([
          { name: 'migrate-auth-service', environmentId: ENV_ID },
          { name: 'app-cleanup-tokens', environmentId: ENV_ID },
        ]),
      );

      const result = await deleteEnvironmentContainerResources(options);

      expect(deleteApp).toHaveBeenCalledWith('app-dev-rg', 'app-auth-service');
      expect(deleteApp).toHaveBeenCalledWith('app-dev-rg', 'app-auth-worker');
      expect(deleteJob).toHaveBeenCalledWith(
        'app-dev-rg',
        'migrate-auth-service',
      );
      expect(result).toEqual({
        deleted: [
          'app-auth-service',
          'app-auth-worker',
          'migrate-auth-service',
        ],
        failed: [],
      });
    });

    it('should leave scheduled jobs (Terraform) alone', async () => {
      listApps.mockReturnValue(items([]));
      listJobs.mockReturnValue(
        items([{ name: 'app-cleanup-tokens', environmentId: ENV_ID }]),
      );

      const result = await deleteEnvironmentContainerResources(options);

      expect(deleteJob).not.toHaveBeenCalled();
      expect(result.deleted).toEqual([]);
    });

    it('should leave resources of another environment alone', async () => {
      listApps.mockReturnValue(
        items([{ name: 'x-api', managedEnvironmentId: OTHER_ENV_ID }]),
      );
      listJobs.mockReturnValue(
        items([{ name: 'migrate-x', environmentId: OTHER_ENV_ID }]),
      );

      await deleteEnvironmentContainerResources(options);

      expect(deleteApp).not.toHaveBeenCalled();
      expect(deleteJob).not.toHaveBeenCalled();
    });

    it('should match the environment id regardless of case', async () => {
      listApps.mockReturnValue(
        items([
          { name: 'app-api', managedEnvironmentId: ENV_ID.toUpperCase() },
        ]),
      );
      listJobs.mockReturnValue(items([]));

      await deleteEnvironmentContainerResources(options);

      expect(deleteApp).toHaveBeenCalledWith('app-dev-rg', 'app-api');
    });
  });

  describe('Edge cases', () => {
    it('should report a failed delete without stopping the others', async () => {
      listApps.mockReturnValue(
        items([
          { name: 'app-a', managedEnvironmentId: ENV_ID },
          { name: 'app-b', managedEnvironmentId: ENV_ID },
        ]),
      );
      listJobs.mockReturnValue(items([]));
      deleteApp
        .mockRejectedValueOnce(
          Object.assign(new Error('Conflict'), { statusCode: 409 }),
        )
        .mockResolvedValueOnce(undefined);

      const result = await deleteEnvironmentContainerResources(options);

      expect(result).toEqual({
        deleted: ['app-b'],
        failed: [{ name: 'app-a', error: 'Conflict' }],
      });
    });

    it('should count a resource already gone as deleted', async () => {
      listApps.mockReturnValue(
        items([{ name: 'app-a', managedEnvironmentId: ENV_ID }]),
      );
      listJobs.mockReturnValue(items([]));
      deleteApp.mockRejectedValue(
        Object.assign(new Error('Not found'), { statusCode: 404 }),
      );

      const result = await deleteEnvironmentContainerResources(options);

      expect(result).toEqual({ deleted: ['app-a'], failed: [] });
    });

    it('should do nothing when the resource group no longer exists', async () => {
      listApps.mockImplementation(() => {
        throw Object.assign(new Error('ResourceGroupNotFound'), {
          statusCode: 404,
        });
      });

      const result = await deleteEnvironmentContainerResources(options);

      expect(result).toEqual({ deleted: [], failed: [] });
    });

    it('should report a listing failure', async () => {
      listApps.mockImplementation(() => {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      });

      const result = await deleteEnvironmentContainerResources(options);

      expect(result).toEqual({
        deleted: [],
        failed: [{ name: 'app-dev-rg', error: 'Forbidden' }],
      });
    });
  });
});
