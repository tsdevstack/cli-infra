import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: rs.fn(),
  deleteEcsService: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

import { awsRemoveDetachedWorker } from './remove-detached-worker';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv, deleteEcsService } from '@tsdevstack/infra-core';

describe('awsRemoveDetachedWorker', () => {
  const mockParams = {
    workerName: 'auth-worker',
    projectRoot: '/test/project',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
  };

  beforeEach(() => {
    rs.resetAllMocks();
    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(getTerraformOutput).mockReturnValue('my-app-cluster');
    rs.mocked(deleteEcsService).mockResolvedValue({
      success: true,
      deleted: true,
    });
  });

  it('should delete ECS service for the worker', async () => {
    await awsRemoveDetachedWorker(mockParams);

    expect(deleteEcsService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serviceName: 'auth-worker',
        clusterName: 'my-app-cluster',
      }),
    );
  });

  it('should log success when worker is deleted', async () => {
    await awsRemoveDetachedWorker(mockParams);

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Deleted worker: auth-worker',
    );
  });

  it('should log info when worker is already deleted', async () => {
    rs.mocked(deleteEcsService).mockResolvedValue({
      success: true,
      deleted: false,
    });

    await awsRemoveDetachedWorker(mockParams);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('already deleted'),
    );
  });

  it('should throw when deletion fails', async () => {
    rs.mocked(deleteEcsService).mockResolvedValue({
      success: false,
      error: 'Permission denied',
      deleted: false,
    });

    await expect(awsRemoveDetachedWorker(mockParams)).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when terraform output fails', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(awsRemoveDetachedWorker(mockParams)).rejects.toThrow(
      mocks.CliError,
    );
  });
});
