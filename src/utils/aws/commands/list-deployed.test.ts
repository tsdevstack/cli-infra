import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../discovery', () => ({
  discoverDeployedServices: rs.fn(),
}));

rs.mock('../../display/parse-image-tag', () => ({
  parseImageTag: rs.fn((uri: string) => uri?.split(':').pop() ?? 'latest'),
}));

rs.mock('../../display/pad-right', () => ({
  padRight: rs.fn((str: string, len: number) => str.padEnd(len)),
}));

import { awsListDeployed } from './list-deployed';
import { discoverDeployedServices } from '../discovery';

describe('awsListDeployed', () => {
  const mockParams = {
    projectName: 'my-app',
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
  });

  it('should display discovered services', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'ACTIVE',
          imageUri: 'ecr/auth-service:abc123',
          resources: {
            ecsService: true,
            appRunnerService: false,
            spaBucket: false,
            runningCount: 1,
            desiredCount: 1,
          },
        },
      ],
    });

    await awsListDeployed(mockParams);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('auth-service'),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Total: 1'),
    );
  });

  it('should show warning when no services found', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [],
    });

    await awsListDeployed(mockParams);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No deployed services found'),
    );
  });

  it('should throw when discovery fails', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: false,
      services: [],
      error: 'Network error',
    });

    await expect(awsListDeployed(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should display multiple service types', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'ACTIVE',
          imageUri: 'ecr/auth:latest',
          resources: {
            ecsService: true,
            appRunnerService: false,
            spaBucket: false,
          },
        },
        {
          name: 'frontend',
          type: 'nextjs',
          status: 'RUNNING',
          imageUri: 'ecr/frontend:latest',
          resources: {
            ecsService: false,
            appRunnerService: true,
            spaBucket: false,
          },
        },
      ],
    });

    await awsListDeployed(mockParams);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Total: 2'),
    );
  });
});
