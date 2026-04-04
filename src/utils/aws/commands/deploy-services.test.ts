import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('./deploy-ecs-services', () => ({
  deployEcsServices: rs.fn(),
}));

rs.mock('./deploy-nextjs-services', () => ({
  deployNextjsServices: rs.fn(),
}));

rs.mock('./deploy-spa-services', () => ({
  deploySpaServices: rs.fn(),
}));

import { awsDeployServices } from './deploy-services';
import { deployEcsServices } from './deploy-ecs-services';
import { deployNextjsServices } from './deploy-nextjs-services';
import { deploySpaServices } from './deploy-spa-services';

describe('awsDeployServices', () => {
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

  const mockConfig = {
    services: [
      { name: 'auth-service', type: 'nestjs' },
      { name: 'frontend', type: 'nextjs' },
      { name: 'landing', type: 'spa' },
    ],
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.loadFrameworkConfig.mockReturnValue(mockConfig);
    rs.mocked(deployEcsServices).mockResolvedValue(undefined);
    rs.mocked(deployNextjsServices).mockResolvedValue(undefined);
    rs.mocked(deploySpaServices).mockResolvedValue(undefined);
  });

  it('should deploy all service types when no filter', async () => {
    await awsDeployServices(mockCtx, {});

    expect(deployEcsServices).toHaveBeenCalled();
    expect(deployNextjsServices).toHaveBeenCalled();
    expect(deploySpaServices).toHaveBeenCalled();
  });

  it('should only deploy ECS when specific nestjs service requested', async () => {
    await awsDeployServices(mockCtx, { service: 'auth-service' });

    expect(deployEcsServices).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        service: 'auth-service',
      }),
    );
    expect(deployNextjsServices).not.toHaveBeenCalled();
    expect(deploySpaServices).not.toHaveBeenCalled();
  });

  it('should only deploy Next.js ECS when specific nextjs service requested', async () => {
    await awsDeployServices(mockCtx, { service: 'frontend' });

    expect(deployNextjsServices).toHaveBeenCalled();
    expect(deployEcsServices).not.toHaveBeenCalled();
    expect(deploySpaServices).not.toHaveBeenCalled();
  });

  it('should only deploy SPA when specific spa service requested', async () => {
    await awsDeployServices(mockCtx, { service: 'landing' });

    expect(deploySpaServices).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        service: 'landing',
      }),
    );
    expect(deployEcsServices).not.toHaveBeenCalled();
    expect(deployNextjsServices).not.toHaveBeenCalled();
  });

  it('should throw when service not found', async () => {
    await expect(
      awsDeployServices(mockCtx, { service: 'nonexistent' }),
    ).rejects.toThrow('Service "nonexistent" not found');
  });

  it('should skip ECS when no nestjs services exist', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'frontend', type: 'nextjs' }],
    });

    await awsDeployServices(mockCtx, {});

    expect(deployEcsServices).not.toHaveBeenCalled();
    expect(deployNextjsServices).toHaveBeenCalled();
  });

  it('should log completion when deploying all', async () => {
    await awsDeployServices(mockCtx, {});

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'All services deployed successfully!',
    );
  });
});
