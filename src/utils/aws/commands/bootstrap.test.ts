import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../verify-aws-credentials', () => ({
  verifyAWSCredentials: rs.fn(),
}));

rs.mock('../check-aws-permissions', () => ({
  checkAWSPermissions: rs.fn(),
}));

import { awsBootstrap } from './bootstrap';
import { verifyAWSCredentials } from '../verify-aws-credentials';
import { checkAWSPermissions } from '../check-aws-permissions';

describe('awsBootstrap', () => {
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

    rs.mocked(verifyAWSCredentials).mockResolvedValue({
      success: true,
      identity: {
        accountId: '123456789012',
        arn: 'arn:aws:iam::123456789012:user/test',
        userId: 'AIDAEXAMPLE',
        principalName: 'test',
        principalType: 'user',
      },
    });

    rs.mocked(checkAWSPermissions).mockResolvedValue({
      success: true,
      allowed: ['ecs:*', 's3:*'],
      denied: [],
    });
  });

  it('should verify credentials', async () => {
    await awsBootstrap(mockCtx);

    expect(verifyAWSCredentials).toHaveBeenCalledWith(mockCtx.credentials);
  });

  it('should throw when credentials verification fails', async () => {
    rs.mocked(verifyAWSCredentials).mockResolvedValue({
      success: false,
      error: 'Invalid credentials',
    });

    await expect(awsBootstrap(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should check permissions after verifying credentials', async () => {
    await awsBootstrap(mockCtx);

    expect(checkAWSPermissions).toHaveBeenCalledWith(
      mockCtx.credentials,
      'arn:aws:iam::123456789012:user/test',
    );
  });

  it('should throw when denied actions exist', async () => {
    rs.mocked(checkAWSPermissions).mockResolvedValue({
      success: true,
      allowed: ['ecs:*'],
      denied: ['s3:CreateBucket'],
    });

    await expect(awsBootstrap(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should succeed when all permissions are allowed', async () => {
    await awsBootstrap(mockCtx);

    expect(mocks.logger.complete).toHaveBeenCalledWith('Bootstrap complete!');
  });

  it('should continue when permission check itself fails', async () => {
    rs.mocked(checkAWSPermissions).mockResolvedValue({
      success: false,
      error: 'No SimulatePrincipalPolicy permission',
      allowed: [],
      denied: [],
    });

    await awsBootstrap(mockCtx);

    expect(mocks.logger.warn).toHaveBeenCalled();
    expect(mocks.logger.complete).toHaveBeenCalledWith('Bootstrap complete!');
  });
});
