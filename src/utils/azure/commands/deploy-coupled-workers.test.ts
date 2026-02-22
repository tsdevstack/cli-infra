import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('./deploy-worker', () => ({
  azureDeployWorker: rs.fn(),
}));

rs.mock('./build-azure-backend-env', () => ({
  buildAzureBackendEnv: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  calculatePoolSize: rs.fn(),
  getTotalWorkerMaxInstances: rs.fn(),
}));

rs.mock('../../deploy/get-total-service-max-instances', () => ({
  getTotalServiceMaxInstances: rs.fn(),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('../../infrastructure/get-service-config', () => ({
  getServiceConfig: rs.fn(),
}));

rs.mock('../../docker', () => ({
  getGitSha: rs.fn(),
}));

import { deployCoupledWorkers } from './deploy-coupled-workers';
import { azureDeployWorker } from './deploy-worker';
import { buildAzureBackendEnv } from './build-azure-backend-env';
import {
  calculatePoolSize,
  getTotalWorkerMaxInstances,
} from '@tsdevstack/infra-core';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/get-service-config';
import { getGitSha } from '../../docker';

describe('deployCoupledWorkers', () => {
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

  const configWithWorker = {
    services: [
      { name: 'auth-service', type: 'nestjs', hasDatabase: true },
      { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      { name: 'offers-service', type: 'nestjs', hasDatabase: true },
      { name: 'offers-worker', type: 'worker', baseService: 'offers-service' },
    ],
  } as Parameters<typeof deployCoupledWorkers>[1];

  beforeEach(() => {
    rs.resetAllMocks();
    rs.mocked(azureDeployWorker).mockResolvedValue(undefined);
    rs.mocked(buildAzureBackendEnv).mockReturnValue({
      envVars: [{ name: 'NODE_ENV', value: 'production' }],
      secrets: [{ name: 'azure-client-secret', value: 'secret-abc' }],
      secretEnvVars: [
        { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' },
      ],
    });
    rs.mocked(calculatePoolSize).mockReturnValue({
      poolMax: 4,
      dbConnections: 112,
      totalUsable: 100,
      totalInstances: 6,
    });
    rs.mocked(getTotalWorkerMaxInstances).mockReturnValue(3);
    rs.mocked(getTotalServiceMaxInstances).mockReturnValue(6);
    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
    rs.mocked(getServiceConfig).mockReturnValue({
      minInstances: 1,
      maxInstances: 3,
      cpu: '0.5',
      memory: '1Gi',
      timeout: '540s',
      port: 3000,
      concurrency: 80,
    });
    rs.mocked(getGitSha).mockReturnValue('abc1234');
  });

  it('should do nothing when no workers are coupled to deployed services', async () => {
    await deployCoupledWorkers(mockCtx, configWithWorker, ['frontend']);

    expect(azureDeployWorker).not.toHaveBeenCalled();
  });

  it('should deploy only workers coupled to the specified service', async () => {
    await deployCoupledWorkers(mockCtx, configWithWorker, ['auth-service']);

    expect(azureDeployWorker).toHaveBeenCalledTimes(1);
    expect(azureDeployWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: {
          name: 'auth-worker',
          type: 'worker',
          baseService: 'auth-service',
        },
        baseService: {
          name: 'auth-service',
          type: 'nestjs',
          hasDatabase: true,
        },
      }),
    );
  });

  it('should deploy all coupled workers when multiple base services deployed', async () => {
    await deployCoupledWorkers(mockCtx, configWithWorker, [
      'auth-service',
      'offers-service',
    ]);

    expect(azureDeployWorker).toHaveBeenCalledTimes(2);
  });

  it('should pass correct parameters to azureDeployWorker', async () => {
    await deployCoupledWorkers(mockCtx, configWithWorker, ['auth-service']);

    expect(azureDeployWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/test/project',
        projectName: 'my-app',
        targetEnv: 'dev',
        credentials: mockCtx.credentials,
        imageTag: 'abc1234',
        envVars: [{ name: 'NODE_ENV', value: 'production' }],
        secrets: [{ name: 'azure-client-secret', value: 'secret-abc' }],
        secretEnvVars: [
          { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' },
        ],
        minReplicas: 1,
        maxReplicas: 3,
        cpu: 0.5,
        memory: '1Gi',
      }),
    );
  });

  it('should use custom tag when provided', async () => {
    await deployCoupledWorkers(
      mockCtx,
      configWithWorker,
      ['auth-service'],
      'v2.0.0',
    );

    expect(azureDeployWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'v2.0.0',
      }),
    );
  });

  it('should throw when worker deployment fails', async () => {
    rs.mocked(azureDeployWorker).mockRejectedValue(
      new Error('Container App creation failed'),
    );

    await expect(
      deployCoupledWorkers(mockCtx, configWithWorker, ['auth-service']),
    ).rejects.toThrow('Failed to deploy 1 worker(s)');
  });

  it('should report all failures when multiple workers fail', async () => {
    rs.mocked(azureDeployWorker).mockRejectedValue(new Error('Deploy failed'));

    await expect(
      deployCoupledWorkers(mockCtx, configWithWorker, [
        'auth-service',
        'offers-service',
      ]),
    ).rejects.toThrow('Failed to deploy 2 worker(s)');
  });

  it('should enforce min 1 replica for workers', async () => {
    rs.mocked(getServiceConfig).mockReturnValue({
      minInstances: 0,
      maxInstances: 3,
      cpu: '0.5',
      memory: '1Gi',
      timeout: '540s',
      port: 3000,
      concurrency: 80,
    });

    await deployCoupledWorkers(mockCtx, configWithWorker, ['auth-service']);

    expect(azureDeployWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        minReplicas: 1,
      }),
    );
  });
});
