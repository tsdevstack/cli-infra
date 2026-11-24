import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../discovery', () => ({
  discoverServiceResources: rs.fn(),
  discoverCoupledWorkers: rs.fn(),
  discoverAwsCronJobs: rs.fn(async () => []),
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

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

rs.mock('../database-export/get-aws-db-exports-bucket', () => ({
  getAwsDbExportsBucket: rs.fn(),
}));
rs.mock('../database-export/run-aws-database-job', () => ({
  runAwsDatabaseJob: rs.fn(),
}));

import { awsRemoveService } from './remove-service';
import {
  discoverServiceResources,
  discoverCoupledWorkers,
  discoverAwsCronJobs,
} from '../discovery';
import {
  hasAnyResources,
  showResourceWarning,
  buildDeletionSteps,
  executeSteps,
  getOtherEnvironments,
  selectServiceInteractive,
} from '../remove-service';
import inquirer from 'inquirer';
import { getAwsDbExportsBucket } from '../database-export/get-aws-db-exports-bucket';
import { runAwsDatabaseJob } from '../database-export/run-aws-database-job';
import type { DeletionStepResult } from '../remove-service/types';

describe('awsRemoveService', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    runningInCI: false,
  };

  const mockParams = {
    serviceName: 'auth-service' as string | undefined,
    ctx: mockCtx,
    runningInCI: false,
    dryRunOption: undefined as boolean | undefined,
    confirmOption: undefined as boolean | undefined,
    skipExportOption: undefined as boolean | undefined,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      cloudFrontDistributions: [],
      secrets: ['DATABASE_URL'],
      inferredType: 'backend',
    });

    rs.mocked(discoverCoupledWorkers).mockResolvedValue([]);
    rs.mocked(discoverAwsCronJobs).mockResolvedValue([]);
    rs.mocked(hasAnyResources).mockReturnValue(true);
    rs.mocked(getOtherEnvironments).mockReturnValue([]);
    rs.mocked(buildDeletionSteps).mockReturnValue([]);
    rs.mocked(getAwsDbExportsBucket).mockReturnValue(
      'my-app-db-exports-123456789012',
    );
    rs.mocked(runAwsDatabaseJob).mockResolvedValue(undefined);
    rs.mocked(executeSteps).mockResolvedValue({
      completed: [],
      failed: null,
      remaining: [],
    });

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service' }],
    });

    // Mock inquirer for mode selection, confirmation
    rs.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });
  });

  it('should throw in CI when no service name provided', async () => {
    await expect(
      awsRemoveService({
        ...mockParams,
        serviceName: undefined,
        runningInCI: true,
      }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should use interactive selection when no service name', async () => {
    rs.mocked(selectServiceInteractive).mockResolvedValue('auth-service');

    await awsRemoveService({
      ...mockParams,
      serviceName: undefined,
      dryRunOption: true,
    });

    expect(selectServiceInteractive).toHaveBeenCalled();
  });

  it('should abort when no resources found', async () => {
    rs.mocked(hasAnyResources).mockReturnValue(false);

    const result = await awsRemoveService(mockParams);

    expect(result.aborted).toBe(true);
  });

  it('should ask nothing with --confirm outside CI, and delete', async () => {
    const result = await awsRemoveService({
      ...mockParams,
      confirmOption: true,
    });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(result.aborted).toBe(false);
    expect(executeSteps).toHaveBeenCalled();
  });

  it('should abort on dry run', async () => {
    const result = await awsRemoveService({
      ...mockParams,
      dryRunOption: true,
    });

    expect(result.aborted).toBe(true);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Dry run complete'),
    );
  });

  it('should abort when user cancels confirmation', async () => {
    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ confirmation: 'wrong-name' });

    const result = await awsRemoveService(mockParams);

    expect(result.aborted).toBe(true);
  });

  it('should execute deletion steps on confirm', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      cloudFrontDistributions: [],
      secrets: [],
      inferredType: 'backend',
    });

    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });

    await awsRemoveService(mockParams);

    expect(buildDeletionSteps).toHaveBeenCalled();
    expect(executeSteps).toHaveBeenCalled();
  });

  it("should pass the service's cron jobs, found by tag, to the warning and the steps", async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      cloudFrontDistributions: [],
      secrets: [],
      inferredType: 'backend',
    });
    const usageReport = {
      name: 'usage-report',
      serviceName: 'auth-service',
      taskFamily: 'my-app-cron-usage-report',
      containerName: 'cron-usage-report',
      logGroupName: '/ecs/my-app/cron-usage-report',
      scheduleName: 'my-app-auth-service-usage-report',
    };
    rs.mocked(discoverAwsCronJobs).mockResolvedValue([
      usageReport,
      { ...usageReport, name: 'other', serviceName: 'bff-service' },
    ]);
    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });

    await awsRemoveService(mockParams);

    expect(showResourceWarning).toHaveBeenCalledWith(
      expect.objectContaining({ coupledCronJobs: [usageReport] }),
    );
    expect(buildDeletionSteps).toHaveBeenCalledWith(
      expect.objectContaining({ coupledCronJobs: [usageReport] }),
    );
  });

  it("should delete nothing when the cron jobs can't be listed", async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      cloudFrontDistributions: [],
      secrets: [],
      inferredType: 'backend',
    });
    rs.mocked(discoverAwsCronJobs).mockRejectedValue(new Error('AccessDenied'));

    await expect(awsRemoveService(mockParams)).rejects.toMatchObject({
      message: "Could not list the cron jobs' task definitions",
    });
    expect(executeSteps).not.toHaveBeenCalled();
  });

  it('should throw when deletion step fails', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      cloudFrontDistributions: [],
      secrets: [],
      inferredType: 'backend',
    });

    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });

    rs.mocked(executeSteps).mockResolvedValue({
      completed: [],
      failed: { name: 'Delete ECS service', resource: 'ecs', execute: rs.fn() },
      remaining: [],
    });

    await expect(awsRemoveService(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should return service name on successful removal', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      cloudFrontDistributions: [],
      secrets: [],
      inferredType: 'backend',
    });

    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });

    const result = await awsRemoveService(mockParams);

    expect(result.aborted).toBe(false);
    expect(result.serviceName).toBe('auth-service');
  });

  describe('saving the database', () => {
    const withDatabaseUrl = () =>
      rs.mocked(discoverServiceResources).mockResolvedValue({
        ecsService: true,
        spaBucket: false,
        spaBucketName: '',
        cloudFrontDistributions: [],
        secrets: ['my-app-auth-service-DATABASE_URL'],
        inferredType: 'backend',
      });
    const saveStep = () =>
      rs.mocked(buildDeletionSteps).mock.calls[0][0].saveDatabase as
        (() => Promise<DeletionStepResult>) | undefined;

    it('should save the database to the bucket before the drop', async () => {
      withDatabaseUrl();

      await awsRemoveService(mockParams);

      const save = saveStep();
      expect(save).toBeDefined();
      expect(await save?.()).toEqual({ success: true, deleted: true });
      expect(runAwsDatabaseJob).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'export',
          serviceName: 'auth-service',
          file: expect.stringMatching(
            /^auth-service\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-removed\.dump$/,
          ),
        }),
      );
    });

    it('should stop before deleting anything without the bucket', async () => {
      withDatabaseUrl();
      rs.mocked(getAwsDbExportsBucket).mockReturnValue(null);

      await expect(awsRemoveService(mockParams)).rejects.toThrow(
        'This environment has no bucket for saved databases yet. Nothing was deleted.',
      );
      expect(executeSteps).not.toHaveBeenCalled();
    });

    it('should not save with --skip-export', async () => {
      withDatabaseUrl();

      await awsRemoveService({ ...mockParams, skipExportOption: true });

      expect(getAwsDbExportsBucket).not.toHaveBeenCalled();
      expect(saveStep()).toBeUndefined();
    });

    it('should not save a backend without a database (no DATABASE_URL)', async () => {
      rs.mocked(discoverServiceResources).mockResolvedValue({
        ecsService: true,
        spaBucket: false,
        spaBucketName: '',
        cloudFrontDistributions: [],
        secrets: [],
        inferredType: 'backend',
      });

      await awsRemoveService(mockParams);

      expect(saveStep()).toBeUndefined();
      // db-delete still runs: it skips what isn't there
      expect(rs.mocked(buildDeletionSteps).mock.calls[0][0].hasDatabase).toBe(
        true,
      );
    });

    it('should no longer ask whether the database was backed up', async () => {
      withDatabaseUrl();

      await awsRemoveService(mockParams);

      const questions = rs
        .mocked(inquirer.prompt)
        .mock.calls.flatMap(
          (call) => call[0] as unknown as Array<{ name: string }>,
        );
      expect(questions.map((q) => q.name)).toEqual(['runMode', 'confirmation']);
    });
  });
});
