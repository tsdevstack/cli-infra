import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  RunTaskCommand: rs.fn(),
  DescribeTasksCommand: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  sleep: rs.fn(),
}));

import { runDbInit } from './run-db-init';

describe('runDbInit', () => {
  const mockOptions = {
    region: 'us-east-1',
    clusterName: 'my-app-cluster',
    taskDefinitionArn:
      'arn:aws:ecs:us-east-1:123456789012:task-definition/db-init',
    subnetIds: ['subnet-1', 'subnet-2'],
    securityGroupId: 'sg-123',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    services: [
      { name: 'auth-service', hasDatabase: true },
      { name: 'offers-service', hasDatabase: true },
      { name: 'frontend', hasDatabase: false },
    ],
  };

  beforeEach(() => {
    rs.clearAllMocks();
    (mocks as Record<string, unknown>).isCIEnv = rs.fn(() => false);
  });

  it('should skip when no services have databases', async () => {
    await runDbInit({
      ...mockOptions,
      services: [{ name: 'frontend', hasDatabase: false }],
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Skipping db-init'),
    );
  });

  it('should run ECS task with SERVICES override', async () => {
    mockSend
      .mockResolvedValueOnce({
        tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }],
      })
      .mockResolvedValueOnce({
        tasks: [
          {
            lastStatus: 'STOPPED',
            containers: [{ name: 'db-init', exitCode: 0 }],
          },
        ],
      });

    await runDbInit(mockOptions);

    expect(mockSend).toHaveBeenCalled();
    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('completed successfully'),
    );
  });

  it('should throw when task fails to start', async () => {
    mockSend.mockResolvedValueOnce({
      tasks: [],
      failures: [{ reason: 'RESOURCE:CPU' }],
    });

    await expect(runDbInit(mockOptions)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when task exits with non-zero code', async () => {
    mockSend
      .mockResolvedValueOnce({
        tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }],
      })
      .mockResolvedValueOnce({
        tasks: [
          {
            lastStatus: 'STOPPED',
            containers: [{ name: 'db-init', exitCode: 1 }],
          },
        ],
      });

    await expect(runDbInit(mockOptions)).rejects.toThrow(mocks.CliError);
  });

  it('should poll until task stops', async () => {
    mockSend
      .mockResolvedValueOnce({
        tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }],
      })
      .mockResolvedValueOnce({
        tasks: [{ lastStatus: 'RUNNING' }],
      })
      .mockResolvedValueOnce({
        tasks: [{ lastStatus: 'RUNNING' }],
      })
      .mockResolvedValueOnce({
        tasks: [
          {
            lastStatus: 'STOPPED',
            containers: [{ name: 'db-init', exitCode: 0 }],
          },
        ],
      });

    await runDbInit(mockOptions);

    // 1 RunTask + 3 DescribeTasks = 4 sends
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('should only run for services with databases', async () => {
    mockSend
      .mockResolvedValueOnce({
        tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }],
      })
      .mockResolvedValueOnce({
        tasks: [
          {
            lastStatus: 'STOPPED',
            containers: [{ name: 'db-init', exitCode: 0 }],
          },
        ],
      });

    await runDbInit(mockOptions);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('auth-service'),
    );
  });
});
