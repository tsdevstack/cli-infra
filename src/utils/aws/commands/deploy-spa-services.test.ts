import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../deploy/deploy-spa-aws', () => ({
  deploySpaAws: rs.fn(),
}));

import { deploySpaServices } from './deploy-spa-services';
import { deploySpaAws } from '../deploy/deploy-spa-aws';

describe('deploySpaServices', () => {
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
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'landing', type: 'spa' },
        { name: 'docs', type: 'spa' },
        { name: 'auth-service', type: 'nestjs' },
      ],
    });
    rs.mocked(deploySpaAws).mockResolvedValue(undefined);
  });

  it('should deploy all SPA services', async () => {
    await deploySpaServices(mockCtx, {});

    expect(deploySpaAws).toHaveBeenCalledTimes(2);
  });

  it('should filter by specific service', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(deploySpaAws).toHaveBeenCalledTimes(1);
    expect(deploySpaAws).toHaveBeenCalledWith(
      expect.objectContaining({
        service: expect.objectContaining({ name: 'landing' }),
      }),
    );
  });

  it('should log info when no SPA services found', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service', type: 'nestjs' }],
    });

    await deploySpaServices(mockCtx, {});

    expect(mocks.logger.info).toHaveBeenCalledWith('No SPA services to deploy');
    expect(deploySpaAws).not.toHaveBeenCalled();
  });

  it('should log completion with count', async () => {
    await deploySpaServices(mockCtx, {});

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      '2 SPA service(s) deployed successfully!',
    );
  });

  it('should pass correct context to deploySpaAws', async () => {
    await deploySpaServices(mockCtx, {});

    expect(deploySpaAws).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/test/project',
        targetEnv: 'dev',
        credentials: mockCtx.credentials,
      }),
    );
  });
});
