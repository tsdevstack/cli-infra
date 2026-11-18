import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('inquirer', () => ({
  default: { prompt: rs.fn() },
}));

rs.mock('../discovery', () => ({
  discoverServiceResources: rs.fn(),
  discoverCoupledWorkers: rs.fn(),
}));

rs.mock('../remove-service', () => ({
  hasAnyResources: rs.fn(),
  showResourceWarning: rs.fn(),
  buildDeletionSteps: rs.fn(),
  executeSteps: rs.fn(),
  showFailureReport: rs.fn(),
  getOtherEnvironments: rs.fn(),
  selectServiceInteractive: rs.fn(),
}));

rs.mock('../database-lock/lift-database-lock', () => ({
  liftDatabaseLock: rs.fn(),
}));

rs.mock('../database-lock/put-database-lock', () => ({
  putDatabaseLock: rs.fn(),
}));

rs.mock('../database-export/get-azure-db-exports', () => ({
  getAzureDbExports: rs.fn(),
}));
rs.mock('../database-export/run-azure-database-job', () => ({
  runAzureDatabaseJob: rs.fn(),
}));

import { azureRemoveService } from './remove-service';
import { discoverServiceResources, discoverCoupledWorkers } from '../discovery';
import {
  hasAnyResources,
  buildDeletionSteps,
  executeSteps,
  getOtherEnvironments,
} from '../remove-service';
import { liftDatabaseLock } from '../database-lock/lift-database-lock';
import { putDatabaseLock } from '../database-lock/put-database-lock';
import { getAzureDbExports } from '../database-export/get-azure-db-exports';
import { runAzureDatabaseJob } from '../database-export/run-azure-database-job';
import type { DeletionStepResult } from '../remove-service/types';
import inquirer from 'inquirer';

const credentials = {
  subscriptionId: 'sub-123',
  tenantId: 't',
  clientId: 'c',
  clientSecret: 's',
  location: 'eastus',
};

const params = {
  serviceName: 'auth-service',
  ctx: {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials,
    runningInCI: true,
  },
  runningInCI: true,
  dryRunOption: false,
  confirmOption: true,
  skipExportOption: undefined as boolean | undefined,
};

const target = {
  credentials,
  resourceGroupName: 'my-app-dev-rg',
  serverName: 'my-app-dev-postgres',
};

const step = {
  name: 'PostgreSQL database',
  resource: 'auth-service',
  execute: rs.fn(),
};

function discovered(hasDatabase: boolean) {
  return {
    containerApp: true,
    spaBucket: false,
    spaBucketName: '',
    secrets: [],
    serviceVaultSecrets: [],
    inferredType: 'backend' as const,
    hasDatabase,
    postgresServerName: 'my-app-dev-postgres',
    vaultName: 'my-app-dev-kv',
    serviceVaultName: 'my-app-dev-auth-service',
  };
}

describe('azureRemoveService', () => {
  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(discoverServiceResources).mockResolvedValue(discovered(true));
    rs.mocked(discoverCoupledWorkers).mockResolvedValue([]);
    rs.mocked(hasAnyResources).mockReturnValue(true);
    rs.mocked(buildDeletionSteps).mockReturnValue([step]);
    rs.mocked(executeSteps).mockResolvedValue({
      completed: [step],
      failed: null,
      remaining: [],
    });
    rs.mocked(getOtherEnvironments).mockReturnValue([]);
    mocks.loadFrameworkConfig.mockReturnValue({ services: [] });
    rs.mocked(liftDatabaseLock).mockResolvedValue(true);
    rs.mocked(putDatabaseLock).mockResolvedValue(undefined);
    rs.mocked(getAzureDbExports).mockReturnValue({
      storageAccount: 'myappdevdbx12b937',
      containerUrl:
        'https://myappdevdbx12b937.blob.core.windows.net/db-exports',
    });
    rs.mocked(runAzureDatabaseJob).mockResolvedValue(undefined);
  });

  describe('database delete lock', () => {
    it('should lift it before the steps and put it back after', async () => {
      await azureRemoveService(params);

      expect(liftDatabaseLock).toHaveBeenCalledWith(target);
      expect(putDatabaseLock).toHaveBeenCalledWith(target);
      const stepsOrder = rs.mocked(executeSteps).mock.invocationCallOrder[0];
      expect(
        rs.mocked(liftDatabaseLock).mock.invocationCallOrder[0],
      ).toBeLessThan(stepsOrder);
      expect(
        rs.mocked(putDatabaseLock).mock.invocationCallOrder[0],
      ).toBeGreaterThan(stepsOrder);
    });

    it('should put it back when a step fails', async () => {
      rs.mocked(executeSteps).mockResolvedValue({
        completed: [],
        failed: step,
        remaining: [],
      });

      await expect(azureRemoveService(params)).rejects.toThrow(mocks.CliError);

      expect(putDatabaseLock).toHaveBeenCalledWith(target);
    });

    it('should put it back when the steps throw', async () => {
      rs.mocked(executeSteps).mockRejectedValue(new Error('boom'));

      await expect(azureRemoveService(params)).rejects.toThrow('boom');

      expect(putDatabaseLock).toHaveBeenCalledWith(target);
    });

    it('should stop with nothing deleted when it cannot be lifted', async () => {
      rs.mocked(liftDatabaseLock).mockRejectedValue(
        new Error('AuthorizationFailed'),
      );

      await expect(azureRemoveService(params)).rejects.toMatchObject({
        name: 'CliError',
        message: expect.stringContaining('AuthorizationFailed'),
        context: 'infra:remove-service',
        hint: expect.stringContaining('Nothing was deleted'),
      });

      expect(executeSteps).not.toHaveBeenCalled();
      expect(putDatabaseLock).not.toHaveBeenCalled();
    });

    it('should not add a lock that was not there', async () => {
      rs.mocked(liftDatabaseLock).mockResolvedValue(false);

      await azureRemoveService(params);

      expect(executeSteps).toHaveBeenCalled();
      expect(putDatabaseLock).not.toHaveBeenCalled();
    });

    it('should leave it alone for a service without a database', async () => {
      rs.mocked(discoverServiceResources).mockResolvedValue(discovered(false));

      await azureRemoveService(params);

      expect(liftDatabaseLock).not.toHaveBeenCalled();
      expect(putDatabaseLock).not.toHaveBeenCalled();
    });

    it('should warn and finish when it cannot be put back', async () => {
      rs.mocked(putDatabaseLock).mockRejectedValue(
        new Error('AuthorizationFailed'),
      );

      await expect(azureRemoveService(params)).resolves.toEqual({
        aborted: false,
        serviceName: 'auth-service',
      });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('next infra:deploy puts it back'),
      );
    });
  });

  describe('saving the database', () => {
    const saveStep = () =>
      rs.mocked(buildDeletionSteps).mock.calls[0][0].saveDatabase as
        (() => Promise<DeletionStepResult>) | undefined;

    it('should save the database to the container before the drop', async () => {
      await azureRemoveService(params);

      const save = saveStep();
      expect(save).toBeDefined();
      expect(await save?.()).toEqual({ success: true, deleted: true });
      expect(runAzureDatabaseJob).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'export',
          serviceName: 'auth-service',
          file: expect.stringMatching(
            /^auth-service\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-removed\.dump$/,
          ),
        }),
      );
    });

    it('should stop before deleting anything without the storage', async () => {
      rs.mocked(getAzureDbExports).mockReturnValue(null);

      await expect(azureRemoveService(params)).rejects.toThrow(
        'This environment has no storage for saved databases yet. Nothing was deleted.',
      );
      expect(executeSteps).not.toHaveBeenCalled();
      expect(liftDatabaseLock).not.toHaveBeenCalled();
    });

    it('should not save with --skip-export', async () => {
      await azureRemoveService({ ...params, skipExportOption: true });

      expect(getAzureDbExports).not.toHaveBeenCalled();
      expect(saveStep()).toBeUndefined();
    });

    it('should not look for the storage without a database', async () => {
      rs.mocked(discoverServiceResources).mockResolvedValue(discovered(false));

      await azureRemoveService(params);

      expect(getAzureDbExports).not.toHaveBeenCalled();
      expect(saveStep()).toBeUndefined();
    });

    it('should ask nothing with --confirm outside CI', async () => {
      await azureRemoveService({
        ...params,
        runningInCI: false,
        dryRunOption: undefined as unknown as boolean,
      });

      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(executeSteps).toHaveBeenCalled();
    });

    it('should no longer ask whether the database was backed up', async () => {
      rs.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });

      await azureRemoveService({
        ...params,
        runningInCI: false,
        dryRunOption: undefined as unknown as boolean,
        confirmOption: undefined as unknown as boolean,
      });

      const questions = rs
        .mocked(inquirer.prompt)
        .mock.calls.flatMap(
          (call) => call[0] as unknown as Array<{ name: string }>,
        );
      expect(questions.map((q) => q.name)).toEqual(['runMode', 'confirmation']);
    });
  });
});
