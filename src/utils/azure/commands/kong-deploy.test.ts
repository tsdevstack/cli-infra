/**
 * Tests for kong-deploy
 */

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

rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: rs.fn(),
}));

rs.mock('./deploy-app-service', () => ({
  deployAppService: rs.fn(),
}));

rs.mock('./set-app-service-settings', () => ({
  setAppServiceSettings: rs.fn(),
}));

rs.mock('../../credentials/fetch-secret', () => ({
  fetchSecret: rs.fn(),
}));

import { azureKongDeploy } from './kong-deploy';
import { getTerraformOutput } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { deployAppService } from './deploy-app-service';
import { setAppServiceSettings } from './set-app-service-settings';
import { fetchSecret } from '../../credentials/fetch-secret';

const testCredentials = {
  subscriptionId: 'sub-123',
  tenantId: 'tenant-456',
  clientId: 'client-789',
  clientSecret: 'secret-abc',
  location: 'eastus',
};

const baseParams = {
  projectRoot: '/test/project',
  targetEnv: 'dev',
  projectName: 'myapp',
  credentials: testCredentials,
  imageTag: 'abc123',
};

describe('azureKongDeploy', () => {
  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, name: string) => {
        const outputs: Record<string, string> = {
          acr_login_server: 'myacr.azurecr.io',
          resource_group_name: 'myapp-dev-rg',
          kong_app_service_name: 'myapp-kong-app',
        };
        return outputs[name] || '';
      },
    );

    rs.mocked(fetchSecret).mockReturnValue(null);
  });

  describe('Standard use cases', () => {
    it('should deploy Kong to App Service with correct image', async () => {
      await azureKongDeploy(baseParams);

      expect(deployAppService).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceGroupName: 'myapp-dev-rg',
          appServiceName: 'myapp-kong-app',
          acrLoginServer: 'myacr.azurecr.io',
          imageUri: 'myacr.azurecr.io/kong:abc123',
        }),
      );
    });

    it('should log success on completion', async () => {
      await azureKongDeploy(baseParams);

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Kong Gateway deployed successfully!',
      );
    });

    it('should fetch and inject Kong secrets as App Service settings', async () => {
      rs.mocked(fetchSecret).mockImplementation((name: string) => {
        if (name === 'REDIS_HOST') return 'redis.example.com';
        if (name === 'REDIS_PORT') return '6380';
        return null;
      });

      await azureKongDeploy(baseParams);

      expect(setAppServiceSettings).toHaveBeenCalledWith(
        testCredentials,
        'myapp-dev-rg',
        'myapp-kong-app',
        expect.objectContaining({
          REDIS_HOST: 'redis.example.com',
          REDIS_PORT: '6380',
        }),
      );
    });

    it('should not call setAppServiceSettings when no secrets found', async () => {
      rs.mocked(fetchSecret).mockReturnValue(null);

      await azureKongDeploy(baseParams);

      expect(setAppServiceSettings).not.toHaveBeenCalled();
    });

    it('should get kong_app_service_name from Terraform outputs', async () => {
      await azureKongDeploy(baseParams);

      expect(getTerraformOutput).toHaveBeenCalledWith(
        expect.stringContaining('terraform/dev'),
        'kong_app_service_name',
        expect.any(Object),
      );
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when Terraform outputs fail', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('Not initialized');
      });

      await expect(azureKongDeploy(baseParams)).rejects.toThrow(mocks.CliError);
    });
  });
});
