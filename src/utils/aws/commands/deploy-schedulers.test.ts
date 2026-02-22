import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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
  getScheduledJobs: rs.fn(),
}));

rs.mock('../terraform', () => ({
  executeTerraform: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: rs.fn(),
  buildAwsTerraformEnv: rs.fn(),
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
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
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
    rs.mocked(getScheduledJobs).mockReturnValue(mockJobs);
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
    rs.mocked(getScheduledJobs).mockReturnValue([]);

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
