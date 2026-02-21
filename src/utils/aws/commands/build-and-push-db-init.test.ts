import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

import { execSync } from 'node:child_process';
import { buildAndPushDbInit } from './build-and-push-db-init';

describe('buildAndPushDbInit', () => {
  const mockOptions = {
    dbInitDir: '/test/project/infrastructure/terraform/dev/db-init',
    ecrUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app/db-init',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
  };

  beforeEach(() => {
    rs.resetAllMocks();
  });

  it('should login to ECR before building', async () => {
    await buildAndPushDbInit(mockOptions);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('ecr get-login-password'),
      expect.anything(),
    );
  });

  it('should build Docker image with linux/amd64 platform', async () => {
    await buildAndPushDbInit(mockOptions);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--platform linux/amd64'),
      expect.objectContaining({
        cwd: mockOptions.dbInitDir,
      }),
    );
  });

  it('should push image to ECR', async () => {
    await buildAndPushDbInit(mockOptions);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('docker push'),
      expect.anything(),
    );
  });

  it('should use correct image tag', async () => {
    await buildAndPushDbInit(mockOptions);

    const pushCall = rs
      .mocked(execSync)
      .mock.calls.find((call) => (call[0] as string).includes('docker push'));
    expect(pushCall?.[0]).toContain(
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app/db-init:latest',
    );
  });
});
