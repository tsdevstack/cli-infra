/**
 * Tests for remove-detached-worker
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../delete', () => ({
  deleteContainerApp: rs.fn(),
}));

rs.mock('../discovery', () => ({
  listContainerApps: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

import {
  azureRemoveDetachedWorker,
  selectWorkerInteractiveAzure,
} from './remove-detached-worker';
import { deleteContainerApp } from '../delete';
import { listContainerApps } from '../discovery';
import inquirer from 'inquirer';

const testCredentials = {
  subscriptionId: 'sub-123',
  tenantId: 'tenant-456',
  clientId: 'client-789',
  clientSecret: 'secret-abc',
  location: 'eastus',
};

const baseParams = {
  workerName: 'email-worker',
  projectName: 'myapp',
  targetEnv: 'dev',
  credentials: testCredentials,
};

describe('azureRemoveDetachedWorker', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('Standard use cases', () => {
    it('should delete the worker Container App', async () => {
      rs.mocked(deleteContainerApp).mockResolvedValue({
        success: true,
        deleted: true,
      });

      await azureRemoveDetachedWorker(baseParams);

      expect(deleteContainerApp).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myapp-dev-rg',
        containerAppName: 'myapp-email-worker',
      });
    });

    it('should derive resource group name from project and env', async () => {
      rs.mocked(deleteContainerApp).mockResolvedValue({
        success: true,
        deleted: true,
      });

      await azureRemoveDetachedWorker({
        ...baseParams,
        projectName: 'other-project',
        targetEnv: 'staging',
      });

      expect(deleteContainerApp).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceGroupName: 'other-project-staging-rg',
        }),
      );
    });

    it('should log success when worker is deleted', async () => {
      rs.mocked(deleteContainerApp).mockResolvedValue({
        success: true,
        deleted: true,
      });

      await azureRemoveDetachedWorker(baseParams);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        'Deleted worker: email-worker',
      );
    });

    it('should log info when worker is already deleted', async () => {
      rs.mocked(deleteContainerApp).mockResolvedValue({
        success: true,
        deleted: false,
      });

      await azureRemoveDetachedWorker(baseParams);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Worker not found (already deleted): email-worker',
      );
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when delete fails', async () => {
      rs.mocked(deleteContainerApp).mockResolvedValue({
        success: false,
        deleted: false,
        error: 'Access denied',
      });

      await expect(azureRemoveDetachedWorker(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });
  });
});

describe('selectWorkerInteractiveAzure', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('Standard use cases', () => {
    it('should list workers and return selected worker name', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myapp-email-worker',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/email-worker:v1',
          },
          {
            name: 'myapp-auth-service',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/auth-service:v1',
          },
        ],
      });

      rs.mocked(inquirer.prompt).mockResolvedValue({
        workerName: 'email-worker',
      });

      const result = await selectWorkerInteractiveAzure(
        testCredentials,
        'myapp',
        'dev',
      );

      expect(result).toBe('email-worker');
    });

    it('should only show apps ending with -worker', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myapp-email-worker',
            status: 'Succeeded',
            image: 'img:v1',
          },
          {
            name: 'myapp-notification-worker',
            status: 'Succeeded',
            image: 'img:v1',
          },
          {
            name: 'myapp-auth-service',
            status: 'Succeeded',
            image: 'img:v1',
          },
        ],
      });

      rs.mocked(inquirer.prompt).mockResolvedValue({
        workerName: 'email-worker',
      });

      await selectWorkerInteractiveAzure(testCredentials, 'myapp', 'dev');

      const promptCall = rs.mocked(inquirer.prompt).mock
        .calls[0][0] as unknown as Array<{
        choices: Array<{ value: string }>;
      }>;
      expect(promptCall[0].choices).toHaveLength(2);
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when listing fails', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: false,
        apps: [],
        error: 'Resource group not found',
      });

      await expect(
        selectWorkerInteractiveAzure(testCredentials, 'myapp', 'dev'),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw CliError when no workers found', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myapp-auth-service',
            status: 'Succeeded',
            image: 'img:v1',
          },
        ],
      });

      await expect(
        selectWorkerInteractiveAzure(testCredentials, 'myapp', 'dev'),
      ).rejects.toThrow(mocks.CliError);
    });
  });
});
