import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getTriggerJobs: rs.fn(),
  getCronJobs: rs.fn(),
}));

rs.mock('./deploy-cron-jobs', () => ({
  awsDeployCronJobs: rs.fn(),
}));

rs.mock('../terraform', () => ({
  executeTerraform: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: rs.fn(),
  buildAwsTerraformEnv: rs.fn(),
  isCronJob: (job: { type?: string }) => job.type === 'cron',
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(),
  },
}));

import fs from 'node:fs';
import { awsDeploySchedulers } from './deploy-schedulers';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import {
  getCronJobs,
  getTriggerJobs,
} from '../../infrastructure/merge-with-defaults';
import { awsDeployCronJobs } from './deploy-cron-jobs';
import { executeTerraform } from '../terraform';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';

describe('awsDeploySchedulers', () => {
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

  const mockJobs = [
    {
      name: 'cleanup-tokens',
      schedule: '0 0 * * *',
      targetService: 'auth-service',
      endpoint: '/auth/jobs/cleanup-tokens',
    },
    {
      name: 'sync-prices',
      schedule: '0 */4 * * *',
      targetService: 'offers-service',
      endpoint: '/offers/jobs/sync-prices',
    },
  ];

  beforeEach(() => {
    rs.resetAllMocks();
    rs.mocked(loadInfrastructureConfig).mockReturnValue({ version: '1' });
    rs.mocked(getTriggerJobs).mockReturnValue(mockJobs);
    rs.mocked(getCronJobs).mockReturnValue([]);
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });
  });

  it('should throw when no scheduled jobs configured', async () => {
    rs.mocked(getTriggerJobs).mockReturnValue([]);

    await expect(
      awsDeploySchedulers(mockCtx, { autoApprove: true }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should deploy each job with correct terraform target', async () => {
    await awsDeploySchedulers(mockCtx, { autoApprove: true });

    const applyCalls = rs
      .mocked(executeTerraform)
      .mock.calls.filter(([cmd]) => cmd === 'apply');

    expect(applyCalls).toHaveLength(2);
    expect(applyCalls[0]![1]).toEqual(
      expect.objectContaining({
        target: 'aws_scheduler_schedule.job["auth-service-cleanup-tokens"]',
      }),
    );
    expect(applyCalls[1]![1]).toEqual(
      expect.objectContaining({
        target: 'aws_scheduler_schedule.job["offers-service-sync-prices"]',
      }),
    );
  });

  describe('Cron jobs', () => {
    const cronJob = {
      name: 'usage-report',
      type: 'cron' as const,
      schedule: '0 3 * * *',
      targetService: 'auth-service',
    };

    it("should apply every schedule, then register the cron jobs' revisions with the image the services run", async () => {
      rs.mocked(getCronJobs).mockReturnValue([cronJob]);
      const order: string[] = [];
      rs.mocked(executeTerraform).mockImplementation(
        async (command, options) => {
          order.push(
            `${command} ${(options as { target?: string }).target ?? ''}`.trim(),
          );
          return { success: true, output: '' };
        },
      );
      rs.mocked(awsDeployCronJobs).mockImplementation(async () => {
        order.push('cron jobs');
        return { deployed: ['usage-report'], skipped: [] };
      });

      await awsDeploySchedulers(mockCtx, { autoApprove: true });

      expect(order).toEqual([
        'init',
        'apply aws_scheduler_schedule.job["auth-service-cleanup-tokens"]',
        'apply aws_scheduler_schedule.job["offers-service-sync-prices"]',
        'apply aws_scheduler_schedule.cron_job["usage-report"]',
        'cron jobs',
      ]);
      expect(awsDeployCronJobs).toHaveBeenCalledWith(
        mockCtx,
        undefined,
        [cronJob],
        { commandName: 'infra:deploy-schedulers' },
      );
    });

    it('should deploy cron jobs without any trigger', async () => {
      rs.mocked(getTriggerJobs).mockReturnValue([]);
      rs.mocked(getCronJobs).mockReturnValue([cronJob]);

      await awsDeploySchedulers(mockCtx, { autoApprove: true });

      expect(awsDeployCronJobs).toHaveBeenCalled();
    });

    it('should need cron-jobs.tf when there are cron jobs', async () => {
      rs.mocked(getCronJobs).mockReturnValue([cronJob]);
      rs.mocked(fs.existsSync).mockImplementation(
        (p) => !String(p).endsWith('cron-jobs.tf'),
      );

      await expect(
        awsDeploySchedulers(mockCtx, { autoApprove: true }),
      ).rejects.toMatchObject({ message: 'cron-jobs.tf not found' });
      expect(executeTerraform).not.toHaveBeenCalled();
    });

    it('should deploy no cron jobs without any', async () => {
      await awsDeploySchedulers(mockCtx, { autoApprove: true });

      expect(awsDeployCronJobs).not.toHaveBeenCalled();
    });
  });

  it('should run terraform init once before deploying', async () => {
    await awsDeploySchedulers(mockCtx, { autoApprove: true });

    const calls = rs.mocked(executeTerraform).mock.calls;
    // init + 2 apply calls
    expect(calls).toHaveLength(3);
    expect(calls[0]![0]).toBe('init');
    expect(calls[1]![0]).toBe('apply');
    expect(calls[2]![0]).toBe('apply');
  });

  it('should stop on first failure', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'apply failed',
      }); // first apply

    await expect(
      awsDeploySchedulers(mockCtx, { autoApprove: true }),
    ).rejects.toThrow(mocks.CliError);

    // Should not have attempted second job
    const applyCalls = rs
      .mocked(executeTerraform)
      .mock.calls.filter(([cmd]) => cmd === 'apply');
    expect(applyCalls).toHaveLength(1);
  });

  it('should log success for all jobs', async () => {
    await awsDeploySchedulers(mockCtx, { autoApprove: true });

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      expect.stringContaining('2'),
    );
  });
});
