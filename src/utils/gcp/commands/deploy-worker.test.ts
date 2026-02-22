import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
  getTerraformOutputJson: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildBackendEnvVars: rs.fn(),
  buildBackendSecrets: rs.fn(),
  buildGcpTerraformEnv: rs.fn(),
  calculatePoolSize: rs.fn(),
  deployCloudRunService: rs.fn(),
  getTotalWorkerMaxInstances: rs.fn(),
  waitForImage: rs.fn(),
}));

rs.mock('../../deploy/get-total-service-max-instances', () => ({
  getTotalServiceMaxInstances: rs.fn(),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

import { gcpDeployWorker } from './deploy-worker';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import {
  buildBackendEnvVars,
  buildBackendSecrets,
  calculatePoolSize,
  deployCloudRunService,
  getTotalWorkerMaxInstances,
  waitForImage,
} from '@tsdevstack/infra-core';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';

describe('gcpDeployWorker', () => {
  const mockCredentials = {
    project_id: 'my-gcp-project',
    client_email: 'sa@my-gcp-project.iam.gserviceaccount.com',
    region: 'us-central1',
  };

  const baseParams = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: mockCredentials,
    worker: {
      name: 'auth-worker',
      type: 'worker' as const,
      baseService: 'auth-service',
    },
    baseService: {
      name: 'auth-service',
      type: 'nestjs' as const,
      hasDatabase: true,
    },
    imageTag: 'abc1234',
  };

  const backendEnvVars: Record<string, string> = {
    NODE_ENV: 'production',
    SECRETS_PROVIDER: 'gcp',
    PROJECT_NAME: 'my-app',
    GCP_PROJECT_ID: 'my-gcp-project',
    DB_POOL_MAX: '5',
  };

  const backendSecrets = [
    {
      envVar: 'DATABASE_URL',
      secretName: 'my-app-auth-service-DATABASE-URL',
      version: 'latest',
    },
  ];

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          artifact_registry_url:
            'us-central1-docker.pkg.dev/my-gcp-project/my-app',
          vpc_id: 'projects/my-gcp-project/global/networks/my-app-vpc',
          subnet_id:
            'projects/my-gcp-project/regions/us-central1/subnetworks/my-app-subnet',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(getTerraformOutputJson).mockReturnValue({
      'auth-service': 'auth-sa@my-gcp-project.iam.gserviceaccount.com',
    });

    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
    rs.mocked(calculatePoolSize).mockReturnValue({
      poolMax: 5,
      dbConnections: 50,
      totalUsable: 45,
      totalInstances: 9,
    });
    rs.mocked(getTotalWorkerMaxInstances).mockReturnValue(3);
    rs.mocked(getTotalServiceMaxInstances).mockReturnValue(6);

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      ],
    });

    rs.mocked(buildBackendEnvVars).mockReturnValue(backendEnvVars);
    rs.mocked(buildBackendSecrets).mockReturnValue(backendSecrets);
    rs.mocked(waitForImage).mockResolvedValue(undefined);
    rs.mocked(deployCloudRunService).mockResolvedValue({ success: true });
  });

  it('should deploy a worker to Cloud Run', async () => {
    await gcpDeployWorker(baseParams);

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'my-gcp-project',
        region: 'us-central1',
        serviceName: 'auth-worker',
        command: ['node', 'dist/worker.js'],
        cpuIdle: false,
        ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
      }),
    );
  });

  it('should use base service image, not worker image', async () => {
    await gcpDeployWorker(baseParams);

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageUri:
          'us-central1-docker.pkg.dev/my-gcp-project/my-app/auth-service:abc1234',
      }),
    );
  });

  it('should use base service account', async () => {
    await gcpDeployWorker(baseParams);

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serviceAccount: 'auth-sa@my-gcp-project.iam.gserviceaccount.com',
      }),
    );
  });

  it('should throw when base service account not found', async () => {
    rs.mocked(getTerraformOutputJson).mockReturnValue({});

    await expect(gcpDeployWorker(baseParams)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(gcpDeployWorker(baseParams)).rejects.toThrow(mocks.CliError);
  });

  it('should verify image exists before deploying', async () => {
    await gcpDeployWorker(baseParams);

    expect(waitForImage).toHaveBeenCalledWith(expect.anything(), {
      imageUri:
        'us-central1-docker.pkg.dev/my-gcp-project/my-app/auth-service:abc1234',
      credentials: mockCredentials,
    });
  });

  it('should calculate pool size dynamically', async () => {
    await gcpDeployWorker(baseParams);

    expect(calculatePoolSize).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gcp',
        totalServiceMaxInstances: 6,
        totalWorkerMaxInstances: 3,
      }),
    );
  });

  it('should use backend env vars with correct pool max', async () => {
    await gcpDeployWorker(baseParams);

    expect(buildBackendEnvVars).toHaveBeenCalledWith({
      provider: 'gcp',
      projectName: 'my-app',
      projectId: 'my-gcp-project',
      poolMax: 5,
    });
  });

  it('should use base service name for secrets scope', async () => {
    await gcpDeployWorker(baseParams);

    expect(buildBackendSecrets).toHaveBeenCalledWith(
      'my-app',
      'auth-service',
      true,
      undefined, // buildSecretName from context (not in mock)
    );
  });

  it('should use default scaling values (1-3)', async () => {
    await gcpDeployWorker(baseParams);

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        minInstances: 1,
        maxInstances: 3,
        cpu: '1',
        memory: '512Mi',
        timeout: '300',
        concurrency: 1,
      }),
    );
  });

  it('should allow overriding scaling values', async () => {
    await gcpDeployWorker({
      ...baseParams,
      minInstances: 2,
      maxInstances: 5,
      cpu: '2',
      memory: '1Gi',
      timeout: '600',
      concurrency: 4,
    });

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        minInstances: 2,
        maxInstances: 5,
        cpu: '2',
        memory: '1Gi',
        timeout: '600',
        concurrency: 4,
      }),
    );
  });

  it('should include VPC network and subnet', async () => {
    await gcpDeployWorker(baseParams);

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        vpcNetwork: 'projects/my-gcp-project/global/networks/my-app-vpc',
        vpcSubnet:
          'projects/my-gcp-project/regions/us-central1/subnetworks/my-app-subnet',
      }),
    );
  });

  it('should log success when deployment succeeds', async () => {
    await gcpDeployWorker(baseParams);

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'Worker auth-worker deployed successfully!',
    );
  });
});
