import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const createOrUpdate = rs.fn();
const mockBuildAcrAuthConfig = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
  buildAcrAuthConfig: (...args: unknown[]) => mockBuildAcrAuthConfig(...args),
  CRON_JOB_COMMAND: ['node', 'dist/cron.js'],
  CRON_JOB_NAME_PREFIX: 'cron-',
}));
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class {
    jobs = { beginCreateOrUpdateAndWait: createOrUpdate };
  },
}));

import { azureDeployCronJob } from './deploy-cron-job';

const credentials = {
  clientId: 'c',
  clientSecret: 's',
  tenantId: 't',
  subscriptionId: 'sub',
  location: 'swedencentral',
};

const params = {
  projectName: 'shop',
  credentials,
  resourceGroupName: 'shop-dev-rg',
  containerAppsEnvId: '/envs/shop-dev-cae',
  job: {
    name: 'usage-report',
    type: 'cron' as const,
    schedule: '0 3 * * *',
    targetService: 'auth-service',
    timeout: 1800,
  },
  image: 'acr.azurecr.io/auth-service:abc',
  envVars: [{ name: 'NODE_ENV', value: 'production' }],
  secrets: [{ name: 'database-url', value: 'postgres://x' }],
  secretEnvVars: [{ name: 'DATABASE_URL', secretRef: 'database-url' }],
  cpu: 1,
  memory: '2Gi',
  platformTimeoutSeconds: 1860,
  acrLoginServer: 'acr.azurecr.io',
  acrManagedIdentityId: '/identities/acr',
  secretsIdentityId: '/identities/auth',
};

describe('azureDeployCronJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    createOrUpdate.mockResolvedValue({});
    mockBuildAcrAuthConfig.mockResolvedValue({
      registries: [{ server: 'acr.azurecr.io', identity: '/identities/acr' }],
      identity: {
        type: 'UserAssigned',
        userAssignedIdentities: { '/identities/acr': {} },
      },
      secrets: [],
    });
  });

  it('should create or update a scheduled Container App Job running the cron command', async () => {
    const result = await azureDeployCronJob(params);

    expect(result).toEqual({ jobName: 'shop-cron-usage-report' });
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
    const [rg, name, job] = createOrUpdate.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(rg).toBe('shop-dev-rg');
    expect(name).toBe('shop-cron-usage-report');
    expect(job).toMatchObject({
      location: 'swedencentral',
      environmentId: '/envs/shop-dev-cae',
      tags: {
        'tsdevstack-cron-service': 'auth-service',
        'tsdevstack-cron-job': 'usage-report',
      },
      configuration: {
        triggerType: 'Schedule',
        replicaTimeout: 1860,
        replicaRetryLimit: 0,
        scheduleTriggerConfig: {
          cronExpression: '0 3 * * *',
          parallelism: 1,
          replicaCompletionCount: 1,
        },
        registries: [{ server: 'acr.azurecr.io', identity: '/identities/acr' }],
        secrets: [{ name: 'database-url', value: 'postgres://x' }],
      },
      template: {
        containers: [
          {
            name: 'shop-cron-usage-report',
            image: 'acr.azurecr.io/auth-service:abc',
            command: ['node', 'dist/cron.js', 'usage-report'],
            resources: { cpu: 1, memory: '2Gi' },
            env: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'DATABASE_URL', secretRef: 'database-url' },
            ],
          },
        ],
      },
    });
  });

  it('should attach the secrets identity next to the ACR identity', async () => {
    await azureDeployCronJob(params);

    const job = createOrUpdate.mock.calls[0][2] as {
      identity: {
        type: string;
        userAssignedIdentities: Record<string, unknown>;
      };
    };
    expect(job.identity.type).toBe('UserAssigned');
    expect(Object.keys(job.identity.userAssignedIdentities)).toEqual([
      '/identities/acr',
      '/identities/auth',
    ]);
    expect(mockBuildAcrAuthConfig).toHaveBeenCalledWith({
      acrLoginServer: 'acr.azurecr.io',
      acrManagedIdentityId: '/identities/acr',
      credentials,
    });
  });

  it("should add the registry's password secret when ACR auth needs one", async () => {
    mockBuildAcrAuthConfig.mockResolvedValue({
      registries: [
        { server: 'acr.azurecr.io', passwordSecretRef: 'acr-password' },
      ],
      secrets: [{ name: 'acr-password', value: 'pw' }],
    });

    await azureDeployCronJob(params);

    const job = createOrUpdate.mock.calls[0][2] as {
      configuration: { secrets: unknown[] };
      identity: { userAssignedIdentities: Record<string, unknown> };
    };
    expect(job.configuration.secrets).toEqual([
      { name: 'acr-password', value: 'pw' },
      { name: 'database-url', value: 'postgres://x' },
    ]);
    expect(Object.keys(job.identity.userAssignedIdentities)).toEqual([
      '/identities/auth',
    ]);
  });

  it('should pass the SDK error on', async () => {
    createOrUpdate.mockRejectedValue(new Error('quota'));

    await expect(azureDeployCronJob(params)).rejects.toThrow('quota');
  });
});
