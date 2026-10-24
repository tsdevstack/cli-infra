import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('./generate-terraform-files', () => ({
  generateTerraformFiles: rs.fn(),
}));

import { azureGenerate } from './generate';
import { generateTerraformFiles } from './generate-terraform-files';

describe('azureGenerate', () => {
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
        kongScaling: { instances: 1, autoscaleMax: null },
        nextjsScaling: { instances: 1, autoscaleMax: null },
      },
    });
  });

  it('should call generateTerraformFiles with verbose', async () => {
    await azureGenerate(mockCtx);

    expect(generateTerraformFiles).toHaveBeenCalledWith(
      mockCtx,
      'infra:generate',
      { verbose: true },
    );
  });

  it('should log project info', async () => {
    await azureGenerate(mockCtx);

    expect(mocks.logger.info).toHaveBeenCalledWith('Project: my-app');
    expect(mocks.logger.info).toHaveBeenCalledWith('Environment: dev');
    expect(mocks.logger.info).toHaveBeenCalledWith('Subscription: sub-123');
    expect(mocks.logger.info).toHaveBeenCalledWith('Location: eastus');
  });

  it('should log next steps', async () => {
    await azureGenerate(mockCtx);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  npx tsdevstack infra:plan --env dev',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  npx tsdevstack infra:deploy --env dev',
    );
  });
});
