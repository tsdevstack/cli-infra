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
import { awsDeployScheduler } from './deploy-scheduler';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { executeTerraform } from '../terraform';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';

describe('awsDeployScheduler', () => {
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
      awsDeployScheduler(mockCtx, { job: 'cleanup-tokens' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when job not found in config', async () => {
    await expect(
      awsDeployScheduler(mockCtx, { job: 'nonexistent-job' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform directory missing', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      awsDeployScheduler(mockCtx, { job: 'cleanup-tokens' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when eventbridge.tf missing', async () => {
    rs.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.endsWith('eventbridge.tf')) return false;
      return true;
    });

    await expect(
      awsDeployScheduler(mockCtx, { job: 'cleanup-tokens' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should run terraform apply with correct target', async () => {
    await awsDeployScheduler(mockCtx, {
      job: 'cleanup-tokens',
      autoApprove: true,
    });

    expect(executeTerraform).toHaveBeenCalledWith('apply', {
      workDir: '/test/project/infrastructure/terraform/dev',
      env: { AWS_REGION: 'us-east-1' },
      autoApprove: true,
      target: 'aws_scheduler_schedule.job["auth-service-cleanup-tokens"]',
      varFile: '/test/project/infrastructure/terraform/dev/terraform.tfvars',
    });
  });

  it('should run terraform init before apply', async () => {
    await awsDeployScheduler(mockCtx, {
      job: 'cleanup-tokens',
      autoApprove: true,
    });

    const calls = rs.mocked(executeTerraform).mock.calls;
    expect(calls[0]![0]).toBe('init');
    expect(calls[1]![0]).toBe('apply');
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(
      awsDeployScheduler(mockCtx, { job: 'cleanup-tokens' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform apply fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' })
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'apply failed',
      });

    await expect(
      awsDeployScheduler(mockCtx, { job: 'cleanup-tokens' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should log success on completion', async () => {
    await awsDeployScheduler(mockCtx, {
      job: 'cleanup-tokens',
      autoApprove: true,
    });

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      expect.stringContaining('cleanup-tokens'),
    );
  });
});
