import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('../../docker', () => ({
  getGitSha: rs.fn(() => 'abc1234'),
}));

rs.mock('../../credentials/fetch-secret', () => ({
  fetchSecret: rs.fn(),
}));

rs.mock('../../credentials/set-secret-via-cli', () => ({
  setSecretViaCli: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-generate', () => ({
  infraDockerGenerate: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-build', () => ({
  infraDockerBuild: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-push', () => ({
  infraDockerPush: rs.fn(),
}));

rs.mock('./db-migrate-run', () => ({
  azureDbMigrateRun: rs.fn(),
}));

const mockConfigureAcrAuth = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildBackendEnvVars: rs.fn(),
  calculatePoolSize: rs.fn(),
  configureAcrAuth: (...args: unknown[]) => mockConfigureAcrAuth(...args),
  getTotalWorkerMaxInstances: rs.fn(),
  parseServiceFilter: rs.fn((service?: string) =>
    service
      ? service
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined,
  ),
  buildAzureTerraformEnv: rs.fn(),
  createOrUpdateContainerApp: rs.fn(),
  waitForContainerAppReady: rs.fn(),
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

import { deployContainerAppServices } from './deploy-container-app-services';
import { getTerraformOutput } from '../terraform';
import { fetchSecret } from '../../credentials/fetch-secret';
import { azureDbMigrateRun } from './db-migrate-run';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import {
  buildBackendEnvVars,
  calculatePoolSize,
  getTotalWorkerMaxInstances,
  buildAzureTerraformEnv,
  createOrUpdateContainerApp,
  waitForContainerAppReady,
} from '@tsdevstack/infra-core';
import { getTotalServiceMaxInstances } from '../../deploy/get-total-service-max-instances';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getServiceConfig } from '../../infrastructure/merge-with-defaults';

describe('deployContainerAppServices', () => {
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

  const backendEnvVars: Record<string, string> = {
    NODE_ENV: 'production',
    SECRETS_PROVIDER: 'azure',
    PROJECT_NAME: 'my-app',
    DB_POOL_MAX: '11',
  };

  const expectedBackendEnvVarsArray = [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'SECRETS_PROVIDER', value: 'azure' },
    { name: 'PROJECT_NAME', value: 'my-app' },
    { name: 'DB_POOL_MAX', value: '11' },
  ];

  beforeEach(() => {
    rs.resetAllMocks();

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'offers-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
        { name: 'landing', type: 'spa' },
      ],
    });

    mockConfigureAcrAuth.mockResolvedValue(undefined);
    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
      ARM_CLIENT_ID: 'client-789',
      ARM_CLIENT_SECRET: 'secret-abc',
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          acr_login_server: 'myapp.azurecr.io',
          resource_group_name: 'my-app-dev-rg',
          container_apps_env_id: '/subscriptions/sub-123/env-id',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
    rs.mocked(getServiceConfig).mockReturnValue({
      minInstances: 1,
      maxInstances: 3,
      cpu: '0.5',
      memory: '1Gi',
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

    rs.mocked(buildBackendEnvVars).mockReturnValue(backendEnvVars);

    rs.mocked(fetchSecret).mockImplementation((key: string) => {
      const secrets: Record<string, string> = {
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/mydb',
        API_URL: 'https://api.example.com',
        ACCESS_TOKEN_TTL: '900',
        REFRESH_TOKEN_TTL: '604800',
      };
      return secrets[key] ?? null;
    });

    rs.mocked(infraDockerBuild).mockResolvedValue(undefined);
    rs.mocked(infraDockerPush).mockResolvedValue(undefined);

    rs.mocked(createOrUpdateContainerApp).mockResolvedValue({
      fqdn: 'my-app-auth-service.azurecontainerapps.io',
    });

    rs.mocked(waitForContainerAppReady).mockResolvedValue({
      status: 'Succeeded',
    });
  });

  it('should deploy only nestjs services (not nextjs or spa)', async () => {
    await deployContainerAppServices(mockCtx, {});

    // auth-service, offers-service (not frontend/nextjs, not landing/spa)
    expect(createOrUpdateContainerApp).toHaveBeenCalledTimes(2);
  });

  it('should filter by specific service', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(createOrUpdateContainerApp).toHaveBeenCalledTimes(1);
    expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        containerAppName: 'my-app-auth-service',
        image: 'myapp.azurecr.io/auth-service:abc1234',
      }),
    );
  });

  it('should use custom image tag', async () => {
    await deployContainerAppServices(mockCtx, {
      service: 'auth-service',
      tag: 'v1.0.0',
    });

    expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        image: 'myapp.azurecr.io/auth-service:v1.0.0',
      }),
    );
  });

  it('should default to latest tag', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        image: 'myapp.azurecr.io/auth-service:abc1234',
      }),
    );
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(deployContainerAppServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should warn when no docker services found', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'landing', type: 'spa' }],
    });

    await deployContainerAppServices(mockCtx, {});

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'No Docker services found to deploy',
    );
    expect(createOrUpdateContainerApp).not.toHaveBeenCalled();
  });

  it('should authenticate Docker once and pass skipAuth to build and push', async () => {
    await deployContainerAppServices(mockCtx, {});

    expect(mockConfigureAcrAuth).toHaveBeenCalledTimes(1);
    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('should throw when container app creation fails', async () => {
    rs.mocked(createOrUpdateContainerApp).mockRejectedValue(
      new Error('Quota exceeded'),
    );

    await expect(deployContainerAppServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when container app fails to stabilize', async () => {
    rs.mocked(waitForContainerAppReady).mockRejectedValue(
      new Error('Container App reached Failed state'),
    );

    await expect(deployContainerAppServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should pass correct options for nestjs service', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        credentials: mockCtx.credentials,
        resourceGroupName: 'my-app-dev-rg',
        containerAppsEnvId: '/subscriptions/sub-123/env-id',
        ingressPort: 3000,
        externalIngress: true,
        minReplicas: 1,
        maxReplicas: 3,
        cpu: 0.5,
        memory: '1Gi',
      }),
    );
  });

  it('should pass correct options to waitForContainerAppReady', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(waitForContainerAppReady).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        credentials: mockCtx.credentials,
        resourceGroupName: 'my-app-dev-rg',
        containerAppName: 'my-app-auth-service',
        timeoutMs: 300000,
      }),
    );
  });

  it('should log fqdn when available', async () => {
    rs.mocked(createOrUpdateContainerApp).mockResolvedValue({
      fqdn: 'my-app-auth.azurecontainerapps.io',
    });

    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(mocks.logger.info).toHaveBeenCalledWith(
      '    URL: https://my-app-auth.azurecontainerapps.io',
    );
  });

  it('should log success without fqdn when not available', async () => {
    rs.mocked(createOrUpdateContainerApp).mockResolvedValue({});

    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      '  auth-service deployed',
    );
  });

  it('should call buildBackendEnvVars with correct config', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(buildBackendEnvVars).toHaveBeenCalledWith({
      provider: 'azure',
      projectName: 'my-app',
      projectId: 'sub-123',
      poolMax: 11,
    });
  });

  it('should pass envVars with Azure credentials and PORT for nestjs services', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        envVars: [
          ...expectedBackendEnvVarsArray,
          { name: 'AZURE_CLIENT_ID', value: 'client-789' },
          { name: 'AZURE_TENANT_ID', value: 'tenant-456' },
          { name: 'AZURE_KEYVAULT_NAME', value: 'my-app-dev-kv' },
          { name: 'PORT', value: '3000' },
        ],
      }),
    );
  });

  it('should inject DATABASE_URL and Azure credentials for nestjs with database', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(fetchSecret).toHaveBeenCalledWith(
      'DATABASE_URL',
      'dev',
      'auth-service',
    );
    expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        secrets: [
          { name: 'azure-client-secret', value: 'secret-abc' },
          {
            name: 'database-url',
            value: 'postgresql://user:pass@db.example.com:5432/mydb',
          },
        ],
        secretEnvVars: [
          { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' },
          { name: 'DATABASE_URL', secretRef: 'database-url' },
        ],
      }),
    );
  });

  it('should inject Azure credentials even when DATABASE_URL not found', async () => {
    rs.mocked(fetchSecret).mockImplementation((key: string) => {
      if (key === 'DATABASE_URL') return null;
      return 'some-value';
    });

    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(fetchSecret).toHaveBeenCalledWith(
      'DATABASE_URL',
      'dev',
      'auth-service',
    );
    expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        secrets: [{ name: 'azure-client-secret', value: 'secret-abc' }],
        secretEnvVars: [
          { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' },
        ],
      }),
    );
  });

  it('should log secret injection when DATABASE_URL is injected', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  Injecting DATABASE_URL secret',
    );
  });

  it('should log Azure credentials injection for nestjs services', async () => {
    await deployContainerAppServices(mockCtx, { service: 'auth-service' });

    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  Injecting Azure credentials for SecretsProvider',
    );
  });

  it('should run migrations for services with databases before deploying', async () => {
    await deployContainerAppServices(mockCtx, {});

    // Should run migrations for auth-service and offers-service (both have hasDatabase: true)
    expect(azureDbMigrateRun).toHaveBeenCalledTimes(2);
    expect(azureDbMigrateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/test/project',
        targetEnv: 'dev',
        projectName: 'my-app',
        credentials: mockCtx.credentials,
        service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        imageTag: 'abc1234',
      }),
    );
    expect(azureDbMigrateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/test/project',
        targetEnv: 'dev',
        projectName: 'my-app',
        credentials: mockCtx.credentials,
        service: { name: 'offers-service', type: 'nestjs', hasDatabase: true },
        imageTag: 'abc1234',
      }),
    );
  });

  it('should not run migrations for nestjs services without databases', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'bff-service', type: 'nestjs', hasDatabase: false }],
    });

    await deployContainerAppServices(mockCtx, { service: 'bff-service' });

    expect(azureDbMigrateRun).not.toHaveBeenCalled();
  });

  it('should pass custom image tag to migrations', async () => {
    await deployContainerAppServices(mockCtx, {
      service: 'auth-service',
      tag: 'v1.0.0',
    });

    expect(azureDbMigrateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'v1.0.0',
      }),
    );
  });
});
