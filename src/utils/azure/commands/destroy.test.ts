import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  executeTerraform: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: rs.fn(),
  buildAzureTerraformEnv: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(),
  },
}));

import fs from 'node:fs';
import inquirer from 'inquirer';
import { azureDestroy } from './destroy';
import { executeTerraform } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';

describe('azureDestroy', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      subscriptionId: 'sub-123',
      tenantId: 'tenant-456',
      clientId: 'client-789',
      clientSecret: 'secret-abc',
      location: 'eastus',
    },
    runningInCI: true,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(fs.existsSync).mockReturnValue(true);

    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
      ARM_CLIENT_ID: 'client-789',
      ARM_CLIENT_SECRET: 'secret-abc',
    });

    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });
  });

  it('should throw when output directory does not exist', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(azureDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should run terraform init and destroy', async () => {
    await azureDestroy(mockCtx, { autoApprove: true });

    expect(executeTerraform).toHaveBeenCalledWith('init', expect.anything());
    expect(executeTerraform).toHaveBeenCalledWith(
      'destroy',
      expect.objectContaining({ autoApprove: true }),
    );
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(azureDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when destroy fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'destroy failed',
      }); // destroy

    await expect(azureDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should prompt for confirmation when not auto-approved', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });

    await azureDestroy({ ...mockCtx, runningInCI: false }, {});

    expect(inquirer.prompt).toHaveBeenCalled();
  });

  it('should abort when user declines confirmation', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

    await azureDestroy({ ...mockCtx, runningInCI: false }, {});

    expect(executeTerraform).not.toHaveBeenCalled();
  });

  it('should log success on completion', async () => {
    await azureDestroy(mockCtx, { autoApprove: true });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Infrastructure destroyed successfully!',
    );
  });
});
