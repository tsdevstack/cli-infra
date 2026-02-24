import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

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

rs.mock('../../docker', () => ({
  getGitSha: rs.fn(() => 'abc1234'),
}));

rs.mock('../../credentials/set-secret-via-cli', () => ({
  setSecretViaCli: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildBackendEnvVars: rs.fn(),
  buildBackendSecrets: rs.fn(),
  buildFrontendEnvVars: rs.fn(),
  buildFrontendSecrets: rs.fn(),
  buildGcpTerraformEnv: rs.fn(),
  calculatePoolSize: rs.fn(),
  deployCloudRunService: rs.fn(),
  getTotalWorkerMaxInstances: rs.fn(),
  waitForImage: rs.fn(),
}));

rs.mock('../../deploy/get-service-secret-keys', () => ({
  getServiceSecretKeys: rs.fn(),
}));

rs.mock('../../deploy/get-total-service-max-instances', () => ({
  getTotalServiceMaxInstances: rs.fn(),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getServiceConfig: rs.fn(),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(() => true),
  },
}));

import { gcpDeployService } from './deploy-service';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import {
  buildBackendEnvVars,
  buildBackendSecrets,
  buildFrontendEnvVars,
  buildFrontendSecrets,
  calculatePoolSize,
  deployCloudRunService,
  getTotalWorkerMaxInstances,
  waitForImage,
} from '@tsdevstack/infra-core';
import { getServiceSecretKeys } from '../../deploy/get-service-secret-keys';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/merge-with-defaults';
import fs from 'node:fs';

describe('gcpDeployService', () => {
  const mockCredentials = {
    project_id: 'my-gcp-project',
    client_email: 'sa@my-gcp-project.iam.gserviceaccount.com',
    region: 'us-central1',
  };

  const baseOptions = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: mockCredentials,
  };

  const backendEnvVars: Record<string, string> = {
    NODE_ENV: 'production',
    SECRETS_PROVIDER: 'gcp',
    PROJECT_NAME: 'my-app',
    GCP_PROJECT_ID: 'my-gcp-project',
    DB_POOL_MAX: '11',
  };

  const backendSecrets = [
    {
      envVar: 'DATABASE_URL',
      secretName: 'my-app-auth-service-DATABASE-URL',
      version: 'latest',
    },
  ];

  const frontendEnvVars: Record<string, string> = {
    NODE_ENV: 'production',
  };

  const frontendSecrets = [
    {
      envVar: 'API_URL',
      secretName: 'my-app-shared-API-URL',
      version: 'latest',
    },
  ];

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(fs.existsSync).mockReturnValue(true);

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
      frontend: 'frontend-sa@my-gcp-project.iam.gserviceaccount.com',
    });

    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
    rs.mocked(getServiceConfig).mockReturnValue({
      minInstances: 1,
      maxInstances: 3,
      cpu: '1',
      memory: '512Mi',
      timeout: '300s',
      port: 3000,
      concurrency: 80,
    });
    rs.mocked(calculatePoolSize).mockReturnValue({
      poolMax: 11,
      dbConnections: 50,
      totalUsable: 45,
      totalInstances: 4,
    });
    rs.mocked(getTotalWorkerMaxInstances).mockReturnValue(3);
    rs.mocked(getTotalServiceMaxInstances).mockReturnValue(6);

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
      ],
    });

    rs.mocked(buildBackendEnvVars).mockReturnValue(backendEnvVars);
    rs.mocked(buildBackendSecrets).mockReturnValue(backendSecrets);
    rs.mocked(buildFrontendEnvVars).mockReturnValue(frontendEnvVars);
    rs.mocked(buildFrontendSecrets).mockReturnValue(frontendSecrets);
    rs.mocked(getServiceSecretKeys).mockReturnValue([]);
    rs.mocked(waitForImage).mockResolvedValue(undefined);
    rs.mocked(deployCloudRunService).mockResolvedValue({
      success: true,
      serviceUrl: 'https://auth-service-abc123-uc.a.run.app',
    });
  });

  it('should deploy a nestjs service to Cloud Run', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
    });

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'my-gcp-project',
        region: 'us-central1',
        serviceName: 'auth-service',
        imageUri:
          'us-central1-docker.pkg.dev/my-gcp-project/my-app/auth-service:abc1234',
        ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
      }),
    );
  });

  it('should deploy a nextjs service with internal load balancer ingress', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'frontend', type: 'nextjs' },
    });

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serviceName: 'frontend',
        ingress: 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
      }),
    );
  });

  it('should throw for unsupported service types', async () => {
    await expect(
      gcpDeployService({
        ...baseOptions,
        service: { name: 'landing', type: 'spa' },
      }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform directory does not exist', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      gcpDeployService({
        ...baseOptions,
        service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
      }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(
      gcpDeployService({
        ...baseOptions,
        service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
      }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when service account not found', async () => {
    rs.mocked(getTerraformOutputJson).mockReturnValue({});

    await expect(
      gcpDeployService({
        ...baseOptions,
        service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
      }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should use custom image tag', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
      tag: 'v1.0.0',
    });

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageUri:
          'us-central1-docker.pkg.dev/my-gcp-project/my-app/auth-service:v1.0.0',
      }),
    );
  });

  it('should verify image exists before deploying', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
    });

    expect(waitForImage).toHaveBeenCalledWith(expect.anything(), {
      imageUri:
        'us-central1-docker.pkg.dev/my-gcp-project/my-app/auth-service:abc1234',
      credentials: mockCredentials,
    });
  });

  it('should calculate pool size for nestjs services', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
    });

    expect(calculatePoolSize).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gcp',
        totalServiceMaxInstances: 6,
        totalWorkerMaxInstances: 3,
      }),
    );
  });

  it('should not calculate pool size for nextjs services', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'frontend', type: 'nextjs' },
    });

    expect(calculatePoolSize).not.toHaveBeenCalled();
  });

  it('should use backend env vars and secrets for nestjs', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
    });

    expect(buildBackendEnvVars).toHaveBeenCalledWith({
      provider: 'gcp',
      projectName: 'my-app',
      projectId: 'my-gcp-project',
      poolMax: 11,
    });
    expect(buildBackendSecrets).toHaveBeenCalled();
  });

  it('should use frontend env vars and secrets for nextjs', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'frontend', type: 'nextjs' },
    });

    expect(buildFrontendEnvVars).toHaveBeenCalled();
    expect(buildFrontendSecrets).toHaveBeenCalled();
  });

  it('should pass service config to Cloud Run', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
    });

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        minInstances: 1,
        maxInstances: 3,
        cpu: '1',
        memory: '512Mi',
        timeout: '300s',
        concurrency: 80,
      }),
    );
  });

  it('should pass VPC network and subnet for direct VPC egress', async () => {
    await gcpDeployService({
      ...baseOptions,
      service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
    });

    expect(deployCloudRunService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        vpcNetwork: 'projects/my-gcp-project/global/networks/my-app-vpc',
        vpcSubnet:
          'projects/my-gcp-project/regions/us-central1/subnetworks/my-app-subnet',
      }),
    );
  });
});
