import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import type { InfraCoreRuntime } from '@tsdevstack/infra-core';

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  configureEcrAuth: rs.fn(),
}));

import { execSync } from 'node:child_process';
import { configureEcrAuth } from '@tsdevstack/infra-core';
import { buildAndPushDbDelete } from './build-and-push-db-delete';

describe('buildAndPushDbDelete', () => {
  const mockRuntime = {
    logger: { info: rs.fn(), success: rs.fn(), error: rs.fn(), warn: rs.fn() },
    executeCommand: rs.fn(),
    writeFile: rs.fn(),
    readFile: rs.fn(),
    ensureDirectory: rs.fn(),
    cleanupFolder: rs.fn(),
    isCIEnv: rs.fn(() => false),
  } as unknown as InfraCoreRuntime;

  const mockOptions = {
    dbDeleteDir: '/test/project/infrastructure/terraform/dev/db-delete',
    ecrUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app/db-delete',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    runtime: mockRuntime,
  };

  beforeEach(() => {
    rs.resetAllMocks();
  });

  it('should call configureEcrAuth before building', async () => {
    await buildAndPushDbDelete(mockOptions);

    expect(configureEcrAuth).toHaveBeenCalledWith(
      mockRuntime,
      mockOptions.credentials,
      mockOptions.ecrUrl,
    );
  });

  it('should build Docker image with linux/amd64 platform', async () => {
    await buildAndPushDbDelete(mockOptions);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--platform linux/amd64'),
      expect.objectContaining({
        cwd: mockOptions.dbDeleteDir,
      }),
    );
  });

  it('should push image to ECR', async () => {
    await buildAndPushDbDelete(mockOptions);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('docker push'),
      expect.anything(),
    );
  });

  it('should use correct image tag', async () => {
    await buildAndPushDbDelete(mockOptions);

    const pushCall = rs
      .mocked(execSync)
      .mock.calls.find((call) => (call[0] as string).includes('docker push'));
    expect(pushCall?.[0]).toContain(
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app/db-delete:latest',
    );
  });
});
