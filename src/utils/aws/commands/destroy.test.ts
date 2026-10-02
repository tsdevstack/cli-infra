import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
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

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

import fs from 'node:fs';
import inquirer from 'inquirer';
import { awsDestroy } from './destroy';
import { executeTerraform } from '../terraform';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';

describe('awsDestroy', () => {
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

  beforeEach(() => {
    rs.resetAllMocks();
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
  });

  it('should throw when terraform directory does not exist', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should prompt for confirmation when not auto-approved', async () => {
    await awsDestroy(mockCtx, {});

    expect(inquirer.prompt).toHaveBeenCalled();
  });

  it('should abort when user declines confirmation', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

    await awsDestroy(mockCtx, {});

    expect(executeTerraform).not.toHaveBeenCalledWith(
      'destroy',
      expect.anything(),
    );
  });

  it('should skip confirmation with autoApprove', async () => {
    await awsDestroy(mockCtx, { autoApprove: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(executeTerraform).toHaveBeenCalledWith('destroy', expect.anything());
  });

  it('should skip confirmation in CI', async () => {
    await awsDestroy({ ...mockCtx, runningInCI: true }, {});

    expect(inquirer.prompt).not.toHaveBeenCalled();
  });

  it('should run terraform init then destroy', async () => {
    await awsDestroy(mockCtx, { autoApprove: true });

    expect(executeTerraform).toHaveBeenCalledWith(
      'init',
      expect.objectContaining({ reconfigure: true }),
    );
    expect(executeTerraform).toHaveBeenCalledWith(
      'destroy',
      expect.objectContaining({
        autoApprove: true,
      }),
    );
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when terraform destroy fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' })
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'destroy failed',
      });

    await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should log success on completion', async () => {
    await awsDestroy(mockCtx, { autoApprove: true });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Infrastructure destroyed successfully!',
    );
  });
});
