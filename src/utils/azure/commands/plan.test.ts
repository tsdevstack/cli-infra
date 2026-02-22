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
  executeTerraform: rs.fn(),
}));

rs.mock('../bootstrap/create-state-backend', () => ({
  createStateBackend: rs.fn(),
}));

rs.mock('./generate-terraform-files', () => ({
  generateTerraformFiles: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  extractLockId: rs.fn(),
  checkTerraformInstalled: rs.fn(),
  buildAzureTerraformEnv: rs.fn(),
}));

import { azurePlan } from './plan';
import { executeTerraform } from '../terraform';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import { extractLockId, buildAzureTerraformEnv } from '@tsdevstack/infra-core';

describe('azurePlan', () => {
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
  });

  it('should create state backend', async () => {
    await azurePlan(mockCtx);

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

    await expect(azurePlan(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should generate terraform files', async () => {
    await azurePlan(mockCtx);

    expect(generateTerraformFiles).toHaveBeenCalledWith(mockCtx, 'infra:plan');
  });

  it('should run terraform init and plan', async () => {
    await azurePlan(mockCtx);

    expect(executeTerraform).toHaveBeenCalledWith('init', expect.anything());
    expect(executeTerraform).toHaveBeenCalledWith('plan', expect.anything());
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(azurePlan(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform plan fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' })
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'plan failed',
      });

    await expect(azurePlan(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should handle force-unlock when plan fails with lock', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: 'Lock ID: abc-123',
        error: 'state locked',
      }) // plan fails
      .mockResolvedValueOnce({ success: true, output: '' }) // force-unlock
      .mockResolvedValueOnce({ success: true, output: '' }); // plan retry

    rs.mocked(extractLockId).mockReturnValue('abc-123');

    await azurePlan(mockCtx, { forceUnlock: true });

    expect(executeTerraform).toHaveBeenCalledWith(
      'force-unlock',
      expect.objectContaining({ lockId: 'abc-123' }),
    );
  });

  it('should log next steps', async () => {
    await azurePlan(mockCtx);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  npx tsdevstack infra:deploy --env dev',
    );
  });
});
