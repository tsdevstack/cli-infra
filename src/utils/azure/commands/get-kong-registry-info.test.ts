/**
 * Tests for get-kong-registry-info
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

import { getAzureKongRegistryInfo } from './get-kong-registry-info';
import { getTerraformOutput } from '../terraform';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';

const testCredentials = {
  subscriptionId: 'sub-123',
  tenantId: 'tenant-456',
  clientId: 'client-789',
  clientSecret: 'secret-abc',
  location: 'eastus',
};

describe('getAzureKongRegistryInfo', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
      ARM_CLIENT_ID: 'client-789',
      ARM_CLIENT_SECRET: 'secret-abc',
    });
  });

  describe('Standard use cases', () => {
    it('should return registry URL and host from Terraform output', () => {
      rs.mocked(getTerraformOutput).mockReturnValue(
        'myprojectdevacr.azurecr.io',
      );

      const result = getAzureKongRegistryInfo(
        '/test/project',
        'dev',
        testCredentials,
      );

      expect(result.registryUrl).toBe('myprojectdevacr.azurecr.io');
      expect(result.registryHost).toBe('myprojectdevacr.azurecr.io');
    });

    it('should call getTerraformOutput with correct arguments', () => {
      rs.mocked(getTerraformOutput).mockReturnValue(
        'myprojectdevacr.azurecr.io',
      );

      getAzureKongRegistryInfo('/test/project', 'dev', testCredentials);

      expect(getTerraformOutput).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev',
        'acr_login_server',
        expect.objectContaining({
          ARM_SUBSCRIPTION_ID: 'sub-123',
        }),
      );
    });

    it('should pass credentials to buildAzureTerraformEnv', () => {
      rs.mocked(getTerraformOutput).mockReturnValue(
        'myprojectdevacr.azurecr.io',
      );

      getAzureKongRegistryInfo('/test/project', 'staging', testCredentials);

      expect(buildAzureTerraformEnv).toHaveBeenCalledWith({}, testCredentials);
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when Terraform output fails', () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('Terraform not initialized');
      });

      expect(() =>
        getAzureKongRegistryInfo('/test/project', 'dev', testCredentials),
      ).toThrow(mocks.CliError);
    });
  });
});
