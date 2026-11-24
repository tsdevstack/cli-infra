import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockDeployCronJob = rs.fn();
rs.mock('./deploy-cron-job', () => ({
  azureDeployCronJob: (...args: unknown[]) => mockDeployCronJob(...args),
}));

const mockGetDeployedImage = rs.fn();
rs.mock('./get-deployed-container-app-image', () => ({
  getDeployedContainerAppImage: (...args: unknown[]) =>
    mockGetDeployedImage(...args),
}));

const mockBuildAzureBackendEnv = rs.fn();
rs.mock('./build-azure-backend-env', () => ({
  buildAzureBackendEnv: (...args: unknown[]) =>
    mockBuildAzureBackendEnv(...args),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: rs.fn(() => ({})),
  calculatePoolSize: rs.fn(() => ({
    poolMax: 7,
    totalUsable: 90,
    totalInstances: 12,
    dbConnections: 100,
  })),
  getTotalWorkerMaxInstances: rs.fn(() => 3),
  CRON_JOB_TIMEOUT: { azure: { min: 1, max: 86400, default: 600 } },
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS: 60,
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: rs.fn(() => ({})) }));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(
    (_dir: string, name: string) =>
      ({
        acr_login_server: 'acr.azurecr.io',
        resource_group_name: 'shop-dev-rg',
        container_apps_env_id: '/envs/shop-dev-cae',
      })[name],
  ),
  getAcrIdentityOutputs: rs.fn(() => ({
    acrManagedIdentityId: '/identities/acr',
    managedIdentityClientId: 'shared-client',
  })),
  getServiceSecretsIdentities: rs.fn(() => ({
    'auth-service': { id: '/identities/auth', client_id: 'auth-client' },
  })),
  getOtlpTracesUrl: rs.fn(() => undefined),
}));

rs.mock('../naming/resolve-azure-naming', () => ({
  resolveAzureNaming: rs.fn(async () => ({
    scheme: 'unique',
    subscriptionId: 'sub',
  })),
}));

rs.mock('../../deploy/get-total-service-max-instances', () => ({
  getTotalServiceMaxInstances: rs.fn(() => 9),
}));
rs.mock('../../deploy/warn-if-small-database-pool', () => ({
  warnIfSmallDatabasePool: rs.fn(),
}));
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => ({ version: '1.0.0', dev: {} })),
}));
rs.mock('../../infrastructure/get-service-config', () => ({
  getServiceConfig: rs.fn(() => ({ logLevel: 'info' })),
}));
rs.mock('../../infrastructure/get-trace-sample-rate', () => ({
  getTraceSampleRate: rs.fn(() => 1),
}));

import { azureDeployCronJobs } from './deploy-cron-jobs';

const ctx = {
  projectRoot: '/project',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    clientId: 'c',
    clientSecret: 's',
    tenantId: 't',
    subscriptionId: 'sub',
    location: 'swedencentral',
  },
  runningInCI: false,
};

const config = {
  project: { name: 'shop', version: '1.0.0' },
  cloud: { provider: 'azure' as const },
  services: [
    { name: 'auth-service', type: 'nestjs', port: 3001, hasDatabase: true },
    { name: 'frontend', type: 'nextjs', port: 4000 },
  ],
};

const job = {
  name: 'usage-report',
  type: 'cron' as const,
  schedule: '0 3 * * *',
  targetService: 'auth-service',
};

describe('azureDeployCronJobs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockBuildAzureBackendEnv.mockReturnValue({
      envVars: [{ name: 'NODE_ENV', value: 'production' }],
      secrets: [],
      secretEnvVars: [],
    });
    mockDeployCronJob.mockResolvedValue({ jobName: 'shop-cron-usage-report' });
    mockGetDeployedImage.mockResolvedValue(
      'acr.azurecr.io/auth-service:deployed',
    );
  });

  it('should do nothing without jobs', async () => {
    await azureDeployCronJobs(ctx, config, [], { commandName: 'x' });
    expect(mockDeployCronJob).not.toHaveBeenCalled();
  });

  it("should deploy each job with the service's image at the given tag, its env and the defaults", async () => {
    await azureDeployCronJobs(ctx, config, [job], {
      imageTag: 'abc123',
      commandName: 'infra:deploy-services',
    });

    expect(mockGetDeployedImage).not.toHaveBeenCalled();
    expect(mockBuildAzureBackendEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'auth-service',
        hasDatabase: true,
        poolMax: 7,
        secretsIdentityClientId: 'auth-client',
        cronJob: { name: 'usage-report', timeoutSeconds: 600 },
      }),
    );
    expect(mockDeployCronJob).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'shop',
        resourceGroupName: 'shop-dev-rg',
        containerAppsEnvId: '/envs/shop-dev-cae',
        job,
        image: 'acr.azurecr.io/auth-service:abc123',
        cpu: 1,
        memory: '2Gi',
        // 600 s, the 60 s margin and the 5-minute start allowance
        platformTimeoutSeconds: 960,
        acrLoginServer: 'acr.azurecr.io',
        acrManagedIdentityId: '/identities/acr',
        secretsIdentityId: '/identities/auth',
      }),
    );
    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('usage-report deployed (shop-cron-usage-report'),
    );
  });

  it("should take the entry's timeout, cpu and memory", async () => {
    await azureDeployCronJobs(
      ctx,
      config,
      [{ ...job, timeout: 1800, cpu: '2', memory: '4Gi' }],
      { imageTag: 'abc', commandName: 'x' },
    );

    expect(mockDeployCronJob).toHaveBeenCalledWith(
      expect.objectContaining({
        cpu: 2,
        memory: '4Gi',
        platformTimeoutSeconds: 2160,
      }),
    );
    expect(mockBuildAzureBackendEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        cronJob: { name: 'usage-report', timeoutSeconds: 1800 },
      }),
    );
  });

  it('should use the image the service runs when no tag is given', async () => {
    await azureDeployCronJobs(ctx, config, [job], { commandName: 'x' });

    expect(mockGetDeployedImage).toHaveBeenCalledWith(
      ctx.credentials,
      'shop-dev-rg',
      'shop-auth-service',
    );
    expect(mockDeployCronJob).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'acr.azurecr.io/auth-service:deployed',
      }),
    );
  });

  it('should stop with the deploy-the-service hint when the service is not deployed', async () => {
    mockGetDeployedImage.mockResolvedValue(undefined);

    await expect(
      azureDeployCronJobs(ctx, config, [job], {
        commandName: 'infra:deploy-schedulers',
      }),
    ).rejects.toMatchObject({
      message: 'Failed to deploy 1 cron job(s)',
      hint: expect.stringContaining(
        'auth-service is not deployed yet: npx tsdevstack infra:deploy-services --env dev --service auth-service',
      ),
    });
    expect(mockDeployCronJob).not.toHaveBeenCalled();
  });

  it('should refuse a job whose service is not a NestJS service or has no identity', async () => {
    await expect(
      azureDeployCronJobs(
        ctx,
        config,
        [
          { ...job, name: 'a', targetService: 'frontend' },
          { ...job, name: 'b', targetService: 'nope' },
        ],
        { imageTag: 'abc', commandName: 'x' },
      ),
    ).rejects.toMatchObject({
      message: 'Failed to deploy 2 cron job(s)',
      hint: expect.stringContaining('frontend is not a NestJS service'),
    });
    expect(mockDeployCronJob).not.toHaveBeenCalled();
  });

  it('should go on after a failed job and report it at the end', async () => {
    mockDeployCronJob
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValueOnce({ jobName: 'shop-cron-b' });

    await expect(
      azureDeployCronJobs(ctx, config, [job, { ...job, name: 'b' }], {
        imageTag: 'abc',
        commandName: 'x',
      }),
    ).rejects.toMatchObject({
      message: 'Failed to deploy 1 cron job(s)',
      hint: 'usage-report: quota',
    });
    expect(mockDeployCronJob).toHaveBeenCalledTimes(2);
  });
});
