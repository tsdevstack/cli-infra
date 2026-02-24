import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

const { mockLoadFrameworkConfig, mockContainerAppsGet } = rs.hoisted(() => ({
  mockLoadFrameworkConfig: rs.fn(),
  mockContainerAppsGet: rs.fn(),
}));

rs.mock('../../../context', () => ({
  getContext: () => ({
    loadFrameworkConfig: mockLoadFrameworkConfig,
  }),
}));

rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class MockContainerAppsAPIClient {
    containerApps = {
      get: mockContainerAppsGet,
    };
    constructor() {}
  },
}));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

import { discoverCoupledWorkers } from './discover-coupled-workers';

describe('discoverCoupledWorkers', () => {
  const mockCredentials: AzureCredentials = {
    subscriptionId: 'sub-123',
    tenantId: 'tenant-456',
    clientId: 'client-789',
    clientSecret: 'secret-abc',
    location: 'eastus',
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should return empty array when no workers are configured', async () => {
    mockLoadFrameworkConfig.mockReturnValue({
      services: [{ name: 'test-service', type: 'nestjs' }],
    } as never);

    const result = await discoverCoupledWorkers({
      baseServiceName: 'test-service',
      projectName: 'my-app',
      targetEnv: 'dev',
      credentials: mockCredentials,
    });

    expect(result).toEqual([]);
    expect(mockContainerAppsGet).not.toHaveBeenCalled();
  });

  it('should return empty array when workers exist but none coupled to service', async () => {
    mockLoadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'test-service', type: 'nestjs' },
        { name: 'other-worker', type: 'worker', baseService: 'other-service' },
      ],
    } as never);

    const result = await discoverCoupledWorkers({
      baseServiceName: 'test-service',
      projectName: 'my-app',
      targetEnv: 'dev',
      credentials: mockCredentials,
    });

    expect(result).toEqual([]);
  });

  it('should return coupled workers that exist in Azure', async () => {
    mockLoadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'test-service', type: 'nestjs' },
        { name: 'test-worker', type: 'worker', baseService: 'test-service' },
      ],
    } as never);

    mockContainerAppsGet.mockResolvedValue({} as never);

    const result = await discoverCoupledWorkers({
      baseServiceName: 'test-service',
      projectName: 'my-app',
      targetEnv: 'dev',
      credentials: mockCredentials,
    });

    expect(result).toEqual([
      { name: 'test-worker', containerAppName: 'my-app-test-worker' },
    ]);
    expect(mockContainerAppsGet).toHaveBeenCalledWith(
      'my-app-dev-rg',
      'my-app-test-worker',
    );
  });

  it('should filter out workers that do not exist in Azure', async () => {
    mockLoadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'test-service', type: 'nestjs' },
        { name: 'test-worker-1', type: 'worker', baseService: 'test-service' },
        { name: 'test-worker-2', type: 'worker', baseService: 'test-service' },
      ],
    } as never);

    mockContainerAppsGet
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('Not found'));

    const result = await discoverCoupledWorkers({
      baseServiceName: 'test-service',
      projectName: 'my-app',
      targetEnv: 'dev',
      credentials: mockCredentials,
    });

    expect(result).toEqual([
      { name: 'test-worker-1', containerAppName: 'my-app-test-worker-1' },
    ]);
  });

  it('should return empty array when config cannot be loaded', async () => {
    mockLoadFrameworkConfig.mockImplementation(() => {
      throw new Error('Config not found');
    });

    const result = await discoverCoupledWorkers({
      baseServiceName: 'test-service',
      projectName: 'my-app',
      targetEnv: 'dev',
      credentials: mockCredentials,
    });

    expect(result).toEqual([]);
  });
});
