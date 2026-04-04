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
  discoverServiceResources: rs.fn(),
  discoverDeployedServices: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

import {
  awsServiceStatus,
  selectServiceInteractiveAws,
} from './service-status';
import {
  discoverServiceResources,
  discoverDeployedServices,
} from '../discovery';
import inquirer from 'inquirer';

describe('awsServiceStatus', () => {
  const mockParams = {
    serviceName: 'auth-service',
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

  it('should display ECS service status', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      ecsRunningCount: 1,
      ecsDesiredCount: 1,
      ecsStatus: 'ACTIVE',
      spaBucket: false,
      spaBucketName: '',
      secrets: ['DATABASE_URL'],
      inferredType: 'backend',
    });

    await awsServiceStatus(mockParams);

    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('ECS Service'),
    );
  });

  it('should display SPA bucket status', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: false,
      spaBucket: true,
      spaBucketName: 'my-app-dev-landing',
      secrets: [],
      inferredType: 'spa',
    });

    await awsServiceStatus(mockParams);

    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('SPA Bucket'),
    );
  });

  it('should show not found for missing resources', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: false,
      spaBucket: false,
      spaBucketName: '',
      secrets: [],
      inferredType: 'unknown',
    });

    await awsServiceStatus(mockParams);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown'),
    );
  });
});

describe('selectServiceInteractiveAws', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  it('should combine config and cloud services', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service' }],
    });

    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'ACTIVE',
          resources: {
            ecsService: true,

            spaBucket: false,
          },
        },
        {
          name: 'old-service',
          type: 'backend',
          status: 'ACTIVE',
          resources: {
            ecsService: true,

            spaBucket: false,
          },
        },
      ],
    });

    rs.mocked(inquirer.prompt).mockResolvedValue({
      serviceName: 'auth-service',
    });

    const result = await selectServiceInteractiveAws({
      projectName: 'my-app',
      credentials: {
        accountId: '123456789012',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-1',
      },
    });

    expect(result).toBe('auth-service');
  });

  it('should throw when no services found', async () => {
    mocks.loadFrameworkConfig.mockImplementation(() => {
      throw new Error('no config');
    });

    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [],
    });

    await expect(
      selectServiceInteractiveAws({
        projectName: 'my-app',
        credentials: {
          accountId: '123456789012',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          region: 'us-east-1',
        },
      }),
    ).rejects.toThrow(mocks.CliError);
  });
});
