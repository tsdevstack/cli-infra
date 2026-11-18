import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../naming/resolve-azure-naming', () => ({
  resolveAzureNaming: async () => ({
    scheme: 'legacy',
    subscriptionId: 'sub-123',
  }),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../resolve-postgres-server-name', () => ({
  resolvePostgresServerName: rs.fn(),
}));

rs.mock('../database-lock/put-database-lock', () => ({
  putDatabaseLock: rs.fn(),
}));

rs.mock('../database-lock/lift-database-lock', () => ({
  liftDatabaseLock: rs.fn(),
}));

rs.mock('../terraform', () => ({
  executeTerraform: rs.fn(),
  getTerraformOutput: rs.fn(),
  getTerraformOutputJson: rs.fn(),
}));

rs.mock('../../credentials/set-secret-via-cli', () => ({
  setSecretViaCli: rs.fn(),
}));

rs.mock('../set-secret-with-retry', () => ({
  setSecretWithRetry: rs.fn(),
}));

rs.mock('../bootstrap/create-state-backend', () => ({
  createStateBackend: rs.fn(),
}));

rs.mock('./generate-terraform-files', () => ({
  generateTerraformFiles: rs.fn(),
}));

rs.mock('../set-up-azure-database-users', () => ({
  setUpAzureDatabaseUsers: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  generateDbInit: rs.fn(() => ({
    dockerfile: 'FROM node',
    packageJson: '{}',
    indexJs: '// init',
  })),
  // Legacy names (the builder has its own tests in infra-core)
  buildAzureResourceName: (
    resource: string,
    o: { projectName: string; environment: string; app?: string },
  ) =>
    ({
      stateStorageAccount: `${o.projectName.replace(/[^a-z0-9]/g, '')}${o.environment}tfstate`,
      blobStorageAccount: `${o.projectName.replace(/[^a-z0-9]/g, '')}${o.environment}storage`,
      appService: `${o.projectName}-${o.environment}-${o.app}`,
      postgresServer: `${o.projectName}-${o.environment}-postgres`,
    })[resource],
  extractLockId: rs.fn(),
  extractImportTargets: rs.fn(() => []),
  detectRouteAssociationError: rs.fn(() => null),
  checkTerraformInstalled: rs.fn(),
  buildAzureTerraformEnv: rs.fn(),
}));

rs.mock('../preflight/check-postgres-availability', () => ({
  checkPostgresAvailability: rs.fn(),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('./upgrade-frontdoor-sku', () => ({
  upgradeFrontdoorSku: rs.fn(),
}));

rs.mock('./lock-down-public-access', () => ({
  lockDownPublicAccess: rs.fn(),
}));

const mockInfraDeployServices = rs.fn();
rs.mock('../../../commands/infra-deploy-services', () => ({
  infraDeployServices: (...args: unknown[]) => mockInfraDeployServices(...args),
}));

const mockInfraKongGenerate = rs.fn();
rs.mock('../../../commands/infra-kong-generate', () => ({
  infraKongGenerate: (...args: unknown[]) => mockInfraKongGenerate(...args),
}));

const mockInfraKongBuild = rs.fn();
rs.mock('../../../commands/infra-kong-build', () => ({
  infraKongBuild: (...args: unknown[]) => mockInfraKongBuild(...args),
}));

const mockInfraKongDeploy = rs.fn();
rs.mock('../../../commands/infra-kong-deploy', () => ({
  infraKongDeploy: (...args: unknown[]) => mockInfraKongDeploy(...args),
}));

import { azureDeploy } from './deploy';
import {
  executeTerraform,
  getTerraformOutput,
  getTerraformOutputJson,
} from '../terraform';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import { extractLockId, buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { checkPostgresAvailability } from '../preflight/check-postgres-availability';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { setSecretViaCli } from '../../credentials/set-secret-via-cli';
import { setUpAzureDatabaseUsers } from '../set-up-azure-database-users';
import { setSecretWithRetry } from '../set-secret-with-retry';
import { upgradeFrontdoorSku } from './upgrade-frontdoor-sku';
import { lockDownPublicAccess } from './lock-down-public-access';
import { resolvePostgresServerName } from '../resolve-postgres-server-name';
import { putDatabaseLock } from '../database-lock/put-database-lock';
import { liftDatabaseLock } from '../database-lock/lift-database-lock';

// Pass-through: the retry itself is covered by apply-with-capacity-retry.test.ts
const mockApplyWithCapacityRetry = rs.fn();
rs.mock('../../deploy/apply-with-capacity-retry', () => ({
  applyWithCapacityRetry: (apply: () => Promise<unknown>, provider: string) => {
    mockApplyWithCapacityRetry(provider);
    return apply();
  },
}));

describe('azureDeploy', () => {
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
    runningInCI: true,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(resolvePostgresServerName).mockReturnValue({
      name: 'my-app-dev-postgres',
      isOverride: false,
    });
    rs.mocked(putDatabaseLock).mockResolvedValue(undefined);
    rs.mocked(liftDatabaseLock).mockResolvedValue(false);
    rs.mocked(setUpAzureDatabaseUsers).mockResolvedValue(undefined);
    mocks.ensureKeyVaultExists.mockResolvedValue({
      exists: true,
      created: false,
    });

    rs.mocked(createStateBackend).mockResolvedValue({
      success: true,
      storageAccountName: 'myappdevtfstate',
      containerName: 'tfstate',
      storageAccountCreated: false,
      containerCreated: false,
    });

    rs.mocked(generateTerraformFiles).mockReturnValue({
      outputDir: '/test/project/infrastructure/terraform/dev',
      generateConfig: {
        provider: 'azure',
        naming: 'legacy',
        projectName: 'my-app',
        environment: 'dev',
        subscriptionId: 'sub-123',
        location: 'eastus',
        storageAccountName: 'myappdevtfstate',
        keyVaultName: 'myproject-dev-kv',
        serviceKeyVaults: {},
        dbJobsKeyVault: 'test-dev-dbjobs',
        databaseServiceKeyVaults: {},
        database: {
          tier: 'B_Standard_B1ms',
          storageSizeGb: 32,
          deletionProtection: false,
          backup: false,
        },
        redis: { tier: 'Basic' },
        servicesWithDatabase: [],
        storageBuckets: [],
        baseDomain: '',
        services: {},
        workers: {},
        allDeployables: {},
        spas: {},
        frontends: {},
        scheduledJobs: {},
        noIndex: false,
        frontdoorPremium: false,
        kongAppServiceSku: 'B1',
        nextjsAppServiceSku: 'B1',
        kongScaling: { instances: 1, autoscaleMax: null },
        nextjsScaling: { instances: 1, autoscaleMax: null },
      },
    });

    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
      ARM_CLIENT_ID: 'client-789',
      ARM_CLIENT_SECRET: 'secret-abc',
    });

    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });

    rs.mocked(checkPostgresAvailability).mockResolvedValue({
      available: true,
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, name: string) => {
        const outputs: Record<string, string> = {
          redis_host: 'my-app-dev-redis.eastus.redis.azure.net',
          redis_port: '10000',
          redis_password: 'test-redis-key',
          database_host: 'my-app-dev-postgres.postgres.database.azure.com',
          database_admin_password: 'test-db-password',
          container_apps_env_default_domain:
            'nicefish-abc123.eastus.azurecontainerapps.io',
          api_url: 'https://api.example.com',
        };
        return outputs[name] || '';
      },
    );

    rs.mocked(setSecretWithRetry).mockResolvedValue(undefined);

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', port: 3000 },
        { name: 'bff-service', port: 3001 },
        { name: 'frontend', type: 'nextjs' },
      ],
    });

    mockInfraDeployServices.mockResolvedValue(undefined);
    mockInfraKongGenerate.mockResolvedValue(undefined);
    mockInfraKongBuild.mockResolvedValue(undefined);
    mockInfraKongDeploy.mockResolvedValue(undefined);

    rs.mocked(upgradeFrontdoorSku).mockResolvedValue(undefined);
    rs.mocked(lockDownPublicAccess).mockResolvedValue(undefined);
  });

  it('should create state backend', async () => {
    await azureDeploy(mockCtx, { autoApprove: true });

    expect(createStateBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'my-app',
        env: 'dev',
      }),
    );
  });

  it('should throw when state backend fails', async () => {
    rs.mocked(createStateBackend).mockResolvedValue({
      success: false,
      error: 'Access denied',
      storageAccountName: '',
      containerName: '',
      storageAccountCreated: false,
      containerCreated: false,
    });

    await expect(azureDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should generate terraform files', async () => {
    await azureDeploy(mockCtx, { autoApprove: true });

    expect(generateTerraformFiles).toHaveBeenCalledWith(
      mockCtx,
      'infra:deploy',
      { naming: { scheme: 'legacy', subscriptionId: 'sub-123' } },
    );
  });

  describe('service Key Vaults', () => {
    const withServiceVaults = (): void => {
      const current = rs.mocked(generateTerraformFiles).getMockImplementation();
      const base = current
        ? current(mockCtx, 'infra:deploy', {
            naming: { scheme: 'legacy', subscriptionId: 'sub-123' },
          })
        : rs.mocked(generateTerraformFiles)(mockCtx, 'infra:deploy', {
            naming: { scheme: 'legacy', subscriptionId: 'sub-123' },
          });
      rs.mocked(generateTerraformFiles).mockReturnValue({
        ...base,
        generateConfig: {
          ...base.generateConfig,
          serviceKeyVaults: {
            'auth-service': 'my-app-dev-auth-service',
            'bff-service': 'my-app-dev-bff-service',
          },
        },
      });
    };

    it("should create every service's vault before Terraform runs", async () => {
      withServiceVaults();
      mocks.ensureKeyVaultExists.mockResolvedValue({
        exists: true,
        created: true,
      });

      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mocks.ensureKeyVaultExists).toHaveBeenCalledWith(
        'my-app',
        'dev',
        mockCtx.credentials,
        'auth-service',
      );
      expect(mocks.ensureKeyVaultExists).toHaveBeenCalledWith(
        'my-app',
        'dev',
        mockCtx.credentials,
        'bff-service',
      );
      const ensureOrder =
        mocks.ensureKeyVaultExists.mock.invocationCallOrder[1];
      const initOrder = rs.mocked(executeTerraform).mock.invocationCallOrder[0];
      expect(ensureOrder).toBeLessThan(initOrder);
    });

    it("should create the database jobs' vault before Terraform runs", async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mocks.ensureKeyVaultExists).toHaveBeenCalledWith(
        'my-app',
        'dev',
        mockCtx.credentials,
        'dbjobs',
      );
    });

    it('should stop when a vault cannot be created', async () => {
      withServiceVaults();
      mocks.ensureKeyVaultExists.mockResolvedValue({
        exists: false,
        created: false,
        error: 'Forbidden',
      });

      await expect(azureDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
        'Failed to create the Key Vault for auth-service',
      );
      expect(executeTerraform).not.toHaveBeenCalled();
    });
  });

  it('should run terraform init and apply', async () => {
    await azureDeploy(mockCtx, { autoApprove: true });

    expect(executeTerraform).toHaveBeenCalledWith('init', expect.anything());
    expect(executeTerraform).toHaveBeenCalledWith(
      'apply',
      expect.objectContaining({ autoApprove: true }),
    );
  });

  it('should apply through the capacity retry', async () => {
    await azureDeploy(mockCtx, { autoApprove: true });

    expect(mockApplyWithCapacityRetry).toHaveBeenCalledWith('azure');
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(azureDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when apply fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'apply failed',
      }); // apply

    await expect(azureDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should ask the preflight for zone-redundant HA when database.ha is on', async () => {
    rs.mocked(loadInfrastructureConfig).mockReturnValue({
      version: '1.0.0',
      dev: { database: { tier: 'GP_Standard_D2s_v3', ha: true } },
    } as ReturnType<typeof loadInfrastructureConfig>);

    await azureDeploy(mockCtx, { autoApprove: true });

    expect(checkPostgresAvailability).toHaveBeenCalledWith(
      mockCtx.credentials,
      { zoneRedundantHa: true },
    );
  });

  it('should not ask for zone-redundant HA by default', async () => {
    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);

    await azureDeploy(mockCtx, { autoApprove: true });

    expect(checkPostgresAvailability).toHaveBeenCalledWith(
      mockCtx.credentials,
      { zoneRedundantHa: false },
    );
  });

  it('should throw when postgres availability check fails', async () => {
    rs.mocked(checkPostgresAvailability).mockResolvedValue({
      available: false,
      error: 'PostgreSQL is not available in eastus',
    });

    await expect(azureDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );

    expect(executeTerraform).not.toHaveBeenCalled();
  });

  it('should handle force-unlock when apply fails with lock', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: 'Lock ID: abc-123',
        error: 'state locked',
      }) // apply fails
      .mockResolvedValueOnce({ success: true, output: '' }) // force-unlock
      .mockResolvedValueOnce({ success: true, output: '' }); // apply retry

    rs.mocked(extractLockId).mockReturnValue('abc-123');

    await azureDeploy(mockCtx, { autoApprove: true, forceUnlock: true });

    expect(executeTerraform).toHaveBeenCalledWith(
      'force-unlock',
      expect.objectContaining({ lockId: 'abc-123' }),
    );
  });

  it('should call upgradeFrontdoorSku before terraform apply', async () => {
    await azureDeploy(mockCtx, { autoApprove: true });

    expect(upgradeFrontdoorSku).toHaveBeenCalledWith({
      credentials: mockCtx.credentials,
      projectName: 'my-app',
      targetEnv: 'dev',
      frontdoorPremium: false,
    });

    // Verify upgrade is called before apply by checking call order
    const upgradeOrder =
      rs.mocked(upgradeFrontdoorSku).mock.invocationCallOrder[0];
    const applyCallIndex = rs
      .mocked(executeTerraform)
      .mock.calls.findIndex((call) => call[0] === 'apply');
    const applyOrder =
      rs.mocked(executeTerraform).mock.invocationCallOrder[applyCallIndex];
    expect(upgradeOrder).toBeLessThan(applyOrder);
  });

  it('should call lockDownPublicAccess with resourceGroupName when frontdoorPremium is true', async () => {
    rs.mocked(generateTerraformFiles).mockReturnValue({
      outputDir: '/test/project/infrastructure/terraform/dev',
      generateConfig: {
        provider: 'azure',
        naming: 'legacy',
        projectName: 'my-app',
        environment: 'dev',
        subscriptionId: 'sub-123',
        location: 'eastus',
        storageAccountName: 'myappdevtfstate',
        keyVaultName: 'myproject-dev-kv',
        serviceKeyVaults: {},
        dbJobsKeyVault: 'test-dev-dbjobs',
        databaseServiceKeyVaults: {},
        database: {
          tier: 'B_Standard_B1ms',
          storageSizeGb: 32,
          deletionProtection: false,
          backup: false,
        },
        redis: { tier: 'Basic' },
        servicesWithDatabase: [],
        storageBuckets: [],
        baseDomain: '',
        services: {},
        workers: {},
        allDeployables: {},
        spas: {},
        frontends: {
          frontend: {
            domain: 'example.com',
            cpu: 1,
            memory: '1Gi',
            minInstances: 1,
            maxInstances: 3,
          },
        },
        scheduledJobs: {},
        noIndex: false,
        frontdoorPremium: true,
        kongAppServiceSku: 'B1',
        nextjsAppServiceSku: 'B1',
        kongScaling: { instances: 1, autoscaleMax: null },
        nextjsScaling: { instances: 1, autoscaleMax: null },
      },
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, name: string) => {
        const outputs: Record<string, string> = {
          resource_group_name: 'my-app-dev-rg',
          redis_host: 'my-app-dev-redis.eastus.redis.azure.net',
          redis_port: '10000',
          redis_password: 'test-redis-key',
          container_apps_env_default_domain:
            'nicefish-abc123.eastus.azurecontainerapps.io',
        };
        return outputs[name] || '';
      },
    );

    await azureDeploy(mockCtx, { autoApprove: true });

    expect(lockDownPublicAccess).toHaveBeenCalledWith({
      credentials: mockCtx.credentials,
      projectName: 'my-app',
      targetEnv: 'dev',
      appServiceNames: ['my-app-dev-kong', 'my-app-dev-frontend'],
      resourceGroupName: 'my-app-dev-rg',
    });
  });

  it('should log success on completion', async () => {
    await azureDeploy(mockCtx, { autoApprove: true });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Infrastructure deployed successfully!',
    );
  });

  describe('post-deploy secret sync', () => {
    it('should sync Redis secrets after successful apply', async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(setSecretViaCli).toHaveBeenCalledWith(
        'REDIS_HOST',
        'my-app-dev-redis.eastus.redis.azure.net',
        'dev',
      );
      expect(setSecretViaCli).toHaveBeenCalledWith(
        'REDIS_PORT',
        '10000',
        'dev',
      );
      expect(setSecretViaCli).toHaveBeenCalledWith(
        'REDIS_PASSWORD',
        'test-redis-key',
        'dev',
      );
      expect(setSecretViaCli).toHaveBeenCalledWith('REDIS_TLS', 'true', 'dev');
    });

    it('should set up the database users of the services with a database', async () => {
      rs.mocked(generateTerraformFiles).mockReturnValue({
        outputDir: '/test/project/infrastructure/terraform/dev',
        generateConfig: {
          provider: 'azure',
          naming: 'legacy',
          projectName: 'my-app',
          environment: 'dev',
          subscriptionId: 'sub-123',
          location: 'eastus',
          storageAccountName: 'myappdevtfstate',
          keyVaultName: 'myproject-dev-kv',
          serviceKeyVaults: {},
          dbJobsKeyVault: 'test-dev-dbjobs',
          databaseServiceKeyVaults: {
            'auth-service': 'my-app-dev-auth-service',
            'offers-service': 'my-app-dev-offers-service',
          },
          database: {
            tier: 'B_Standard_B1ms',
            storageSizeGb: 32,
            deletionProtection: false,
            backup: false,
          },
          redis: { tier: 'Basic' },
          servicesWithDatabase: [
            { name: 'auth-service', hasDatabase: true },
            { name: 'bff-service', hasDatabase: false },
            { name: 'offers-service', hasDatabase: true },
          ],
          storageBuckets: [],
          baseDomain: '',
          services: {},
          workers: {},
          allDeployables: {},
          spas: {},
          frontends: {},
          scheduledJobs: {},
          noIndex: false,
          frontdoorPremium: false,
          kongAppServiceSku: 'B1',
          nextjsAppServiceSku: 'B1',
          kongScaling: { instances: 1, autoscaleMax: null },
          nextjsScaling: { instances: 1, autoscaleMax: null },
        },
      });

      await azureDeploy(mockCtx, { autoApprove: true });

      expect(setUpAzureDatabaseUsers).toHaveBeenCalledWith({
        terraformDir: '/test/project/infrastructure/terraform/dev',
        tfEnv: expect.any(Object),
        projectName: 'my-app',
        targetEnv: 'dev',
        credentials: mockCtx.credentials,
        serviceNames: ['auth-service', 'offers-service'],
        dbJobsKeyVault: 'test-dev-dbjobs',
        serviceKeyVaults: {
          'auth-service': 'my-app-dev-auth-service',
          'offers-service': 'my-app-dev-offers-service',
        },
      });
      // The server admin's URL is no longer written anywhere
      expect(setSecretViaCli).not.toHaveBeenCalledWith(
        'DATABASE_URL',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should fail the deploy when the database users cannot be set up', async () => {
      rs.mocked(generateTerraformFiles).mockReturnValue({
        outputDir: '/test/project/infrastructure/terraform/dev',
        generateConfig: {
          ...rs.mocked(generateTerraformFiles)(mockCtx, 'infra:deploy', {
            naming: { scheme: 'legacy', subscriptionId: 'sub-123' },
          }).generateConfig,
          servicesWithDatabase: [{ name: 'auth-service', hasDatabase: true }],
        },
      });
      rs.mocked(setUpAzureDatabaseUsers).mockRejectedValue(
        new Error('db-init (init) failed'),
      );

      await expect(azureDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
        'db-init (init) failed',
      );
    });

    it('should sync service URLs with full FQDN to Key Vault', async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(setSecretWithRetry).toHaveBeenCalledWith(
        'AUTH_SERVICE_URL',
        'https://my-app-auth-service.nicefish-abc123.eastus.azurecontainerapps.io',
        'dev',
      );
      expect(setSecretWithRetry).toHaveBeenCalledWith(
        'BFF_SERVICE_URL',
        'https://my-app-bff-service.nicefish-abc123.eastus.azurecontainerapps.io',
        'dev',
      );
      // frontend has no port — should NOT get a URL
      expect(setSecretWithRetry).not.toHaveBeenCalledWith(
        'FRONTEND_URL',
        expect.anything(),
        'dev',
      );
    });

    it('should set KONG_INTERNAL_URL from the kong_internal_url output with Next.js apps', async () => {
      const base = (
        rs.mocked(generateTerraformFiles) as unknown as () => ReturnType<
          typeof generateTerraformFiles
        >
      )();
      rs.mocked(generateTerraformFiles).mockReturnValue({
        ...base,
        generateConfig: {
          ...base.generateConfig,
          frontends: {
            frontend: {
              domain: 'example.com',
              cpu: 1,
              memory: '1Gi',
              minInstances: 1,
              maxInstances: 1,
            },
          },
        },
      });
      rs.mocked(getTerraformOutput).mockImplementation(
        (_dir: string, name: string) =>
          name === 'kong_internal_url'
            ? 'https://my-app-dev-kong.azurewebsites.net'
            : 'nicefish-abc123.eastus.azurecontainerapps.io',
      );

      await azureDeploy(mockCtx, { autoApprove: true });

      expect(setSecretWithRetry).toHaveBeenCalledWith(
        'KONG_INTERNAL_URL',
        'https://my-app-dev-kong.azurewebsites.net',
        'dev',
      );
    });

    it('should not set KONG_INTERNAL_URL without Next.js apps', async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(setSecretWithRetry).not.toHaveBeenCalledWith(
        'KONG_INTERNAL_URL',
        expect.anything(),
        'dev',
      );
    });

    it('should not fail deploy if secret sync fails', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('output not found');
      });

      // Should not throw — secret sync failure is non-fatal
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Failed to sync Redis secrets automatically',
      );
    });
  });

  describe('infraOnly guard', () => {
    it('should skip services and Kong when infraOnly is true', async () => {
      await azureDeploy(mockCtx, { autoApprove: true, infraOnly: true });

      expect(mockInfraDeployServices).not.toHaveBeenCalled();
      expect(mockInfraKongGenerate).not.toHaveBeenCalled();
      expect(mockInfraKongBuild).not.toHaveBeenCalled();
      expect(mockInfraKongDeploy).not.toHaveBeenCalled();
    });

    it('should log skip message when infraOnly is true', async () => {
      await azureDeploy(mockCtx, { autoApprove: true, infraOnly: true });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipped'),
      );
    });
  });

  describe('post-infra deployment phases', () => {
    it('should deploy services after infrastructure', async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mockInfraDeployServices).toHaveBeenCalledWith({
        env: 'dev',
        tag: undefined,
      });
    });

    it('should pass tag to service deployment', async () => {
      await azureDeploy(mockCtx, { autoApprove: true, tag: 'v1.2.3' });

      expect(mockInfraDeployServices).toHaveBeenCalledWith({
        env: 'dev',
        tag: 'v1.2.3',
      });
    });

    it('should deploy Kong after services', async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mockInfraKongGenerate).toHaveBeenCalledWith({
        env: 'dev',
        nextSteps: false,
      });
      expect(mockInfraKongBuild).toHaveBeenCalledWith({
        env: 'dev',
        tag: undefined,
        nextSteps: false,
      });
      expect(mockInfraKongDeploy).toHaveBeenCalledWith({
        env: 'dev',
        tag: undefined,
        nextSteps: false,
      });
    });

    it('should pass tag to Kong deployment', async () => {
      await azureDeploy(mockCtx, { autoApprove: true, tag: 'v1.2.3' });

      expect(mockInfraKongBuild).toHaveBeenCalledWith({
        env: 'dev',
        tag: 'v1.2.3',
        nextSteps: false,
      });
      expect(mockInfraKongDeploy).toHaveBeenCalledWith({
        env: 'dev',
        tag: 'v1.2.3',
        nextSteps: false,
      });
    });

    it('should log completion banner', async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Full infrastructure deployment complete!',
      );
    });

    it("should print the DNS zone's name servers after the banner, without trailing dots", async () => {
      rs.mocked(getTerraformOutputJson).mockImplementation(((
        _dir: string,
        name: string,
      ) =>
        name === 'dns_name_servers'
          ? ['ns1-09.azure-dns.com.', 'ns2-09.azure-dns.net.']
          : undefined) as unknown as typeof getTerraformOutputJson);

      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        '    ns1-09.azure-dns.com',
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '    ns2-09.azure-dns.net',
      );
      const bannerOrder = Math.max(
        ...mocks.logger.complete.mock.invocationCallOrder,
      );
      const dnsIndex = mocks.logger.info.mock.calls.findIndex(
        (call: unknown[]) => call[0] === 'DNS Setup Required:',
      );
      expect(
        mocks.logger.info.mock.invocationCallOrder[dnsIndex],
      ).toBeGreaterThan(bannerOrder);
    });
  });

  describe('database delete lock', () => {
    const target = {
      credentials: mockCtx.credentials,
      resourceGroupName: 'my-app-dev-rg',
      serverName: 'my-app-dev-postgres',
    };

    it('should put the lock on after the apply by default', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue(null);

      await azureDeploy(mockCtx, { autoApprove: true });

      expect(resolvePostgresServerName).toHaveBeenCalledWith(
        'my-app',
        'dev',
        null,
        { scheme: 'legacy', subscriptionId: 'sub-123' },
      );
      expect(putDatabaseLock).toHaveBeenCalledWith(target);
      expect(liftDatabaseLock).not.toHaveBeenCalled();
      expect(
        rs.mocked(putDatabaseLock).mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        Math.max(...rs.mocked(executeTerraform).mock.invocationCallOrder),
      );
    });

    it('should lift it before the apply when database.deletionProtection is false', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1.0.0',
        dev: { database: { deletionProtection: false } },
      } as ReturnType<typeof loadInfrastructureConfig>);
      rs.mocked(liftDatabaseLock).mockResolvedValue(true);

      await azureDeploy(mockCtx, { autoApprove: true });

      expect(liftDatabaseLock).toHaveBeenCalledWith(target);
      expect(putDatabaseLock).not.toHaveBeenCalled();
      const applyIndex = rs
        .mocked(executeTerraform)
        .mock.calls.findIndex((call) => call[0] === 'apply');
      expect(
        rs.mocked(liftDatabaseLock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        rs.mocked(executeTerraform).mock.invocationCallOrder[applyIndex],
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Delete lock lifted'),
      );
    });

    it('should not apply when the lock cannot be lifted', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1.0.0',
        dev: { database: { deletionProtection: false } },
      } as ReturnType<typeof loadInfrastructureConfig>);
      rs.mocked(liftDatabaseLock).mockRejectedValue(
        new Error('AuthorizationFailed'),
      );

      await expect(
        azureDeploy(mockCtx, { autoApprove: true }),
      ).rejects.toMatchObject({
        name: 'CliError',
        context: 'infra:deploy',
        hint: expect.stringContaining('Terraform has not applied anything'),
      });

      expect(executeTerraform).not.toHaveBeenCalledWith(
        'apply',
        expect.anything(),
      );
    });

    it('should not put the lock on when the apply fails', async () => {
      rs.mocked(executeTerraform)
        .mockResolvedValueOnce({ success: true, output: '' }) // init
        .mockResolvedValueOnce({
          success: false,
          output: '',
          error: 'apply failed',
        }); // apply

      await expect(azureDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
        mocks.CliError,
      );

      expect(putDatabaseLock).not.toHaveBeenCalled();
    });

    it('should stop before the services when Azure refuses the lock', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
      rs.mocked(putDatabaseLock).mockRejectedValue(
        new Error('AuthorizationFailed'),
      );

      await expect(
        azureDeploy(mockCtx, { autoApprove: true }),
      ).rejects.toMatchObject({
        name: 'CliError',
        message: expect.stringContaining('AuthorizationFailed'),
        context: 'infra:deploy',
        hint: expect.stringContaining('User Access Administrator'),
      });
      expect(mockInfraDeployServices).not.toHaveBeenCalled();
    });
  });
});
