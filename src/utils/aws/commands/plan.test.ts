import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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

rs.mock('../bootstrap/create-state-backend', () => ({
  createStateBackend: rs.fn(),
}));

rs.mock('./generate-terraform-files', () => ({
  generateTerraformFiles: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: rs.fn(),
  extractLockId: rs.fn(),
  buildAwsTerraformEnv: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

import { awsPlan } from './plan';
import { executeTerraform } from '../terraform';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import { extractLockId, buildAwsTerraformEnv } from '@tsdevstack/infra-core';

describe('awsPlan', () => {
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

    rs.mocked(createStateBackend).mockResolvedValue({
      success: true,
      bucketName: 'my-app-terraform-state-123456789012',
      tableName: 'my-app-terraform-locks',
      bucketCreated: false,
      tableCreated: false,
    });

    rs.mocked(generateTerraformFiles).mockReturnValue({
      outputDir: '/test/project/infrastructure/terraform/dev',
      generateConfig: {} as never,
      servicesWithDatabase: [],
    });

    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });
  });

  it('should create state backend before planning', async () => {
    await awsPlan(mockCtx);

    expect(createStateBackend).toHaveBeenCalledWith({
      projectName: 'my-app',
      accountId: '123456789012',
      credentials: mockCtx.credentials,
    });
  });

  it('should throw when state backend fails', async () => {
    rs.mocked(createStateBackend).mockResolvedValue({
      success: false,
      error: 'Access denied',
      bucketName: '',
      tableName: '',
      bucketCreated: false,
      tableCreated: false,
    });

    await expect(awsPlan(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should generate terraform files', async () => {
    await awsPlan(mockCtx);

    expect(generateTerraformFiles).toHaveBeenCalledWith(mockCtx, 'infra:plan');
  });

  it('should run terraform init with reconfigure', async () => {
    await awsPlan(mockCtx);

    expect(executeTerraform).toHaveBeenCalledWith(
      'init',
      expect.objectContaining({
        reconfigure: true,
      }),
    );
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(awsPlan(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should run terraform plan after init', async () => {
    await awsPlan(mockCtx);

    expect(executeTerraform).toHaveBeenCalledWith('plan', expect.anything());
  });

  it('should throw when terraform plan fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' })
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'plan failed',
      });

    await expect(awsPlan(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should force unlock and retry when plan fails with lock', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: 'Lock ID: abc-123',
        error: 'state locked',
      }) // plan fails
      .mockResolvedValueOnce({ success: true, output: '' }) // force-unlock
      .mockResolvedValueOnce({ success: true, output: '' }); // plan retry

    rs.mocked(extractLockId).mockReturnValue('abc-123');

    await awsPlan(mockCtx, { forceUnlock: true });

    expect(executeTerraform).toHaveBeenCalledWith(
      'force-unlock',
      expect.objectContaining({
        lockId: 'abc-123',
      }),
    );
  });

  it('should not force unlock when option is not set', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' })
      .mockResolvedValueOnce({
        success: false,
        output: 'Lock ID: abc-123',
        error: 'state locked',
      });

    await expect(awsPlan(mockCtx)).rejects.toThrow(mocks.CliError);
    expect(executeTerraform).not.toHaveBeenCalledWith(
      'force-unlock',
      expect.anything(),
    );
  });

  it('should show next steps on success', async () => {
    await awsPlan(mockCtx);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('infra:deploy'),
    );
  });
});
