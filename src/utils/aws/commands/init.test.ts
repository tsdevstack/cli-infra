import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../bootstrap/create-state-backend', () => ({
  createStateBackend: rs.fn(),
}));

import { awsInit } from './init';
import { createStateBackend } from '../bootstrap/create-state-backend';

describe('awsInit', () => {
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
      bucketCreated: true,
      bucketPolicySet: false,
      tableCreated: true,
    });
  });

  it('should create state backend with correct params', async () => {
    await awsInit(mockCtx);

    expect(createStateBackend).toHaveBeenCalledWith({
      projectName: 'my-app',
      accountId: '123456789012',
      credentials: mockCtx.credentials,
    });
  });

  it('should throw when state backend creation fails', async () => {
    rs.mocked(createStateBackend).mockResolvedValue({
      success: false,
      error: 'Permission denied',
      bucketName: '',
      tableName: '',
      bucketCreated: false,
      bucketPolicySet: false,
      tableCreated: false,
    });

    await expect(awsInit(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should log success when bucket is created', async () => {
    await awsInit(mockCtx);

    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('Created S3 bucket'),
    );
  });

  it('should log existing when bucket already exists', async () => {
    rs.mocked(createStateBackend).mockResolvedValue({
      success: true,
      bucketName: 'my-app-terraform-state-123456789012',
      tableName: 'my-app-terraform-locks',
      bucketCreated: false,
      bucketPolicySet: false,
      tableCreated: false,
    });

    await awsInit(mockCtx);

    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );
    expect(mocks.logger.success).not.toHaveBeenCalledWith(
      expect.stringContaining('HTTPS'),
    );
  });

  it('should say when an existing bucket now refuses requests without HTTPS', async () => {
    rs.mocked(createStateBackend).mockResolvedValue({
      success: true,
      bucketName: 'my-app-terraform-state-123456789012',
      tableName: 'my-app-terraform-locks',
      bucketCreated: false,
      bucketPolicySet: true,
      tableCreated: false,
    });

    await awsInit(mockCtx);

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'S3 bucket now refuses requests without HTTPS',
    );
  });

  it('should show next steps on success', async () => {
    await awsInit(mockCtx);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('infra:generate'),
    );
  });
});
