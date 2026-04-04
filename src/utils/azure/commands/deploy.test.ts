import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  executeTerraform: rs.fn(),
  getTerraformOutput: rs.fn(),
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

rs.mock('@tsdevstack/infra-core', () => ({
  extractLockId: rs.fn(),
  extractImportTargets: rs.fn(() => []),
  detectRouteAssociationError: rs.fn(() => null),
  checkTerraformInstalled: rs.fn(),
  buildAzureTerraformEnv: rs.fn(),
}));

rs.mock('../preflight/check-postgres-availability', () => ({
  checkPostgresAvailability: rs.fn(),
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
import { executeTerraform, getTerraformOutput } from '../terraform';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import { extractLockId, buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { checkPostgresAvailability } from '../preflight/check-postgres-availability';
import { setSecretViaCli } from '../../credentials/set-secret-via-cli';
import { setSecretWithRetry } from '../set-secret-with-retry';
import { upgradeFrontdoorSku } from './upgrade-frontdoor-sku';
import { lockDownPublicAccess } from './lock-down-public-access';

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
        projectName: 'my-app',
        environment: 'dev',
        subscriptionId: 'sub-123',
        location: 'eastus',
        storageAccountName: 'myappdevtfstate',
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
    );
  });

  it('should run terraform init and apply', async () => {
    await azureDeploy(mockCtx, { autoApprove: true });

    expect(executeTerraform).toHaveBeenCalledWith('init', expect.anything());
    expect(executeTerraform).toHaveBeenCalledWith(
      'apply',
      expect.objectContaining({ autoApprove: true }),
    );
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
        projectName: 'my-app',
        environment: 'dev',
        subscriptionId: 'sub-123',
        location: 'eastus',
        storageAccountName: 'myappdevtfstate',
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

    it('should sync DATABASE_URL per service with database', async () => {
      rs.mocked(generateTerraformFiles).mockReturnValue({
        outputDir: '/test/project/infrastructure/terraform/dev',
        generateConfig: {
          provider: 'azure',
          projectName: 'my-app',
          environment: 'dev',
          subscriptionId: 'sub-123',
          location: 'eastus',
          storageAccountName: 'myappdevtfstate',
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
        },
      });

      await azureDeploy(mockCtx, { autoApprove: true });

      expect(setSecretViaCli).toHaveBeenCalledWith(
        'DATABASE_URL',
        expect.stringContaining('postgresql://tsdevstack:'),
        'dev',
        'auth-service',
      );
      expect(setSecretViaCli).toHaveBeenCalledWith(
        'DATABASE_URL',
        expect.stringContaining('postgresql://tsdevstack:'),
        'dev',
        'offers-service',
      );
      // bff-service has hasDatabase: false, should NOT get DATABASE_URL
      expect(setSecretViaCli).not.toHaveBeenCalledWith(
        'DATABASE_URL',
        expect.anything(),
        'dev',
        'bff-service',
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

      expect(mockInfraKongGenerate).toHaveBeenCalledWith({ env: 'dev' });
      expect(mockInfraKongBuild).toHaveBeenCalledWith({
        env: 'dev',
        tag: undefined,
      });
      expect(mockInfraKongDeploy).toHaveBeenCalledWith({
        env: 'dev',
        tag: undefined,
      });
    });

    it('should pass tag to Kong deployment', async () => {
      await azureDeploy(mockCtx, { autoApprove: true, tag: 'v1.2.3' });

      expect(mockInfraKongBuild).toHaveBeenCalledWith({
        env: 'dev',
        tag: 'v1.2.3',
      });
      expect(mockInfraKongDeploy).toHaveBeenCalledWith({
        env: 'dev',
        tag: 'v1.2.3',
      });
    });

    it('should log completion banner', async () => {
      await azureDeploy(mockCtx, { autoApprove: true });

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Full infrastructure deployment complete!',
      );
    });
  });
});
