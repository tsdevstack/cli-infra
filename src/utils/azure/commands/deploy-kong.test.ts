/**
 * Tests for azureKongDeploy
 */

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
  getTerraformOutput: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: rs.fn(),
  AZURE_KONG_CLIENT_IP_SETTINGS: {
    KONG_TRUSTED_IPS: '169.254.0.0/16',
    KONG_REAL_IP_HEADER: 'X-Azure-SocketIP',
    KONG_REAL_IP_RECURSIVE: 'off',
  },
}));

rs.mock('./deploy-app-service', () => ({
  deployAppService: rs.fn(),
}));

rs.mock('../key-vault/grant-key-vault-secret-read', () => ({
  grantKeyVaultSecretRead: rs.fn(),
}));

rs.mock('../key-vault/wait-for-key-vault-references', () => ({
  waitForKeyVaultReferences: rs.fn(),
}));

import { azureKongDeploy } from './deploy-kong';
import { getTerraformOutput } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';
import { deployAppService } from './deploy-app-service';
import { grantKeyVaultSecretRead } from '../key-vault/grant-key-vault-secret-read';
import { waitForKeyVaultReferences } from '../key-vault/wait-for-key-vault-references';

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
          kong_principal_id: 'kong-principal',
        };
        return outputs[name] || '';
      },
    );
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

    it("should set the client address settings and Kong's runtime secrets as Key Vault references", async () => {
      await azureKongDeploy(baseParams);

      const reference = (secret: string) =>
        `@Microsoft.KeyVault(VaultName=myapp-dev-kv;SecretName=myapp-shared-${secret})`;
      expect(deployAppService).toHaveBeenCalledWith(
        expect.objectContaining({
          appSettings: {
            KONG_TRUSTED_IPS: '169.254.0.0/16',
            KONG_REAL_IP_HEADER: 'X-Azure-SocketIP',
            KONG_REAL_IP_RECURSIVE: 'off',
            REDIS_PASSWORD: reference('REDIS-PASSWORD'),
            KONG_TRUST_TOKEN: reference('KONG-TRUST-TOKEN'),
            KONG_FRONTEND_TOKEN: reference('KONG-FRONTEND-TOKEN'),
          },
        }),
      );
    });

    it("should let Kong's identity read exactly its secrets, before the deploy", async () => {
      await azureKongDeploy(baseParams);

      expect(grantKeyVaultSecretRead).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myapp-dev-rg',
        keyVaultName: 'myapp-dev-kv',
        secretNames: [
          'myapp-shared-REDIS-PASSWORD',
          'myapp-shared-KONG-TRUST-TOKEN',
          'myapp-shared-KONG-FRONTEND-TOKEN',
        ],
        principalId: 'kong-principal',
      });
      expect(
        rs.mocked(grantKeyVaultSecretRead).mock.invocationCallOrder[0],
      ).toBeLessThan(rs.mocked(deployAppService).mock.invocationCallOrder[0]);
    });

    it('should wait until Kong has received its secrets', async () => {
      await azureKongDeploy(baseParams);

      expect(waitForKeyVaultReferences).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myapp-dev-rg',
        appServiceName: 'myapp-kong-app',
        settingNames: [
          'REDIS_PASSWORD',
          'KONG_TRUST_TOKEN',
          'KONG_FRONTEND_TOKEN',
        ],
      });
      expect(
        rs.mocked(waitForKeyVaultReferences).mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        rs.mocked(deployAppService).mock.invocationCallOrder[0],
      );
    });

    it('should log success on completion', async () => {
      await azureKongDeploy(baseParams);

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Kong Gateway deployed successfully!',
      );
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
