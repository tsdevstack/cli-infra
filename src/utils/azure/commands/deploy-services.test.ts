import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('./deploy-container-app-services', () => ({
  deployContainerAppServices: rs.fn(),
}));

rs.mock('./deploy-nextjs-app-services', () => ({
  deployNextjsAppServices: rs.fn(),
}));

rs.mock('./deploy-spa-services', () => ({
  deploySpaServices: rs.fn(),
}));

rs.mock('./deploy-coupled-workers', () => ({
  deployCoupledWorkers: rs.fn(),
}));

import { azureDeployServices } from './deploy-services';
import { deployContainerAppServices } from './deploy-container-app-services';
import { deployNextjsAppServices } from './deploy-nextjs-app-services';
import { deploySpaServices } from './deploy-spa-services';
import { deployCoupledWorkers } from './deploy-coupled-workers';

describe('azureDeployServices', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      subscriptionId: 'sub-123',
      tenantId: 'tenant-456',
      clientId: 'client-789',
      clientSecret: 'secret-abc',
      location: 'eastus',
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
    rs.mocked(deployContainerAppServices).mockResolvedValue(undefined);
    rs.mocked(deployNextjsAppServices).mockResolvedValue(undefined);
    rs.mocked(deploySpaServices).mockResolvedValue(undefined);
    rs.mocked(deployCoupledWorkers).mockResolvedValue(undefined);
  });

  it('should deploy all service types when no filter', async () => {
    await azureDeployServices(mockCtx, {});

    expect(deployContainerAppServices).toHaveBeenCalled();
    expect(deployNextjsAppServices).toHaveBeenCalled();
    expect(deploySpaServices).toHaveBeenCalled();
  });

  it('should deploy coupled workers when deploying all services', async () => {
    await azureDeployServices(mockCtx, {});

    expect(deployCoupledWorkers).toHaveBeenCalledWith(
      mockCtx,
      mockConfig,
      ['auth-service', 'frontend'],
      undefined,
    );
  });

  it('should only deploy Container Apps when specific nestjs service requested', async () => {
    await azureDeployServices(mockCtx, { service: 'auth-service' });

    expect(deployContainerAppServices).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        service: 'auth-service',
      }),
    );
    expect(deploySpaServices).not.toHaveBeenCalled();
  });

  it('should deploy coupled workers for specific service', async () => {
    await azureDeployServices(mockCtx, { service: 'auth-service' });

    expect(deployCoupledWorkers).toHaveBeenCalledWith(
      mockCtx,
      mockConfig,
      ['auth-service'],
      undefined,
    );
  });

  it('should pass tag to coupled workers for specific service', async () => {
    await azureDeployServices(mockCtx, {
      service: 'auth-service',
      tag: 'v1.0.0',
    });

    expect(deployCoupledWorkers).toHaveBeenCalledWith(
      mockCtx,
      mockConfig,
      ['auth-service'],
      'v1.0.0',
    );
  });

  it('should deploy to App Service when specific nextjs service requested', async () => {
    await azureDeployServices(mockCtx, { service: 'frontend' });

    expect(deployNextjsAppServices).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        service: 'frontend',
      }),
    );
    expect(deployContainerAppServices).not.toHaveBeenCalled();
    expect(deploySpaServices).not.toHaveBeenCalled();
  });

  it('should only deploy SPA when specific spa service requested', async () => {
    await azureDeployServices(mockCtx, { service: 'landing' });

    expect(deploySpaServices).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        service: 'landing',
      }),
    );
    expect(deployContainerAppServices).not.toHaveBeenCalled();
    expect(deployNextjsAppServices).not.toHaveBeenCalled();
  });

  it('should throw when service not found', async () => {
    await expect(
      azureDeployServices(mockCtx, { service: 'nonexistent' }),
    ).rejects.toThrow('Service "nonexistent" not found');
  });

  it('should throw for non-deployable service type', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'my-worker', type: 'worker' }],
    });

    await expect(
      azureDeployServices(mockCtx, { service: 'my-worker' }),
    ).rejects.toThrow('Service type "worker" is not deployable');
  });

  it('should skip Container Apps and App Service when no docker services exist', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'landing', type: 'spa' }],
    });

    await azureDeployServices(mockCtx, {});

    expect(deployContainerAppServices).not.toHaveBeenCalled();
    expect(deployNextjsAppServices).not.toHaveBeenCalled();
    expect(deploySpaServices).toHaveBeenCalled();
  });

  it('should skip SPA and App Service when only nestjs services exist', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service', type: 'nestjs' }],
    });

    await azureDeployServices(mockCtx, {});

    expect(deployContainerAppServices).toHaveBeenCalled();
    expect(deployNextjsAppServices).not.toHaveBeenCalled();
    expect(deploySpaServices).not.toHaveBeenCalled();
  });

  it('should pass options through to deployContainerAppServices and deployNextjsAppServices', async () => {
    await azureDeployServices(mockCtx, {
      tag: 'v1.0.0',
      skipGenerate: true,
      maxParallel: 4,
    });

    expect(deployContainerAppServices).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        tag: 'v1.0.0',
        skipGenerate: true,
        maxParallel: 4,
      }),
    );
    expect(deployNextjsAppServices).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        tag: 'v1.0.0',
        skipGenerate: true,
        maxParallel: 4,
      }),
    );
  });

  it('should log completion when deploying all', async () => {
    await azureDeployServices(mockCtx, {});

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'All services deployed successfully!',
    );
  });
});
