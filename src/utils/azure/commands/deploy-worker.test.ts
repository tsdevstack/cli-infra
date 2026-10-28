/**
 * Tests for deploy-worker
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
  getAcrIdentityOutputs: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: rs.fn(),
  deployWithActivationCheck: rs.fn(),
}));

import { azureDeployWorker } from './deploy-worker';
import { getTerraformOutput, getAcrIdentityOutputs } from '../terraform';
import {
  buildAzureTerraformEnv,
  deployWithActivationCheck,
} from '@tsdevstack/infra-core';

const testCredentials = {
  subscriptionId: 'sub-123',
  tenantId: 'tenant-456',
  clientId: 'client-789',
  clientSecret: 'secret-abc',
  location: 'eastus',
};

const baseParams = {
  projectRoot: '/test/project',
  projectName: 'myapp',
  targetEnv: 'dev',
  credentials: testCredentials,
  worker: { name: 'email-worker', type: 'worker' as const },
  baseService: { name: 'auth-service', type: 'backend' as const },
  imageTag: 'abc123',
  envVars: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'DB_POOL_MAX', value: '4' },
  ],
  secrets: [{ name: 'database-url', value: 'postgresql://...' }],
  secretEnvVars: [{ name: 'DATABASE_URL', secretRef: 'database-url' }],
  minReplicas: 1,
  maxReplicas: 3,
  cpu: 0.5,
  memory: '1Gi',
  secretsIdentityId: '/identities/auth-service-secrets',
};

describe('azureDeployWorker', () => {
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
          container_apps_env_id: '/subscriptions/sub/envs/env',
        };
        return outputs[name] || '';
      },
    );

    rs.mocked(getAcrIdentityOutputs).mockReturnValue({
      acrManagedIdentityId: undefined,
      managedIdentityClientId: undefined,
    });

    rs.mocked(deployWithActivationCheck).mockResolvedValue({
      activated: true,
    });
  });

  describe('Standard use cases', () => {
    it('should deploy worker with base service image', async () => {
      await azureDeployWorker(baseParams);

      expect(deployWithActivationCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          containerAppName: 'myapp-email-worker',
          createOptions: expect.objectContaining({
            image: 'myacr.azurecr.io/auth-service:abc123',
            containerAppName: 'myapp-email-worker',
          }),
        }),
      );
    });

    it('should pass acrManagedIdentityId when available from Terraform output', async () => {
      rs.mocked(getAcrIdentityOutputs).mockReturnValue({
        acrManagedIdentityId: '/subscriptions/sub/identity/ca-id',
        managedIdentityClientId: undefined,
      });

      await azureDeployWorker(baseParams);

      expect(deployWithActivationCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          createOptions: expect.objectContaining({
            acrManagedIdentityId: '/subscriptions/sub/identity/ca-id',
          }),
        }),
      );
    });

    it('should fall back to no managed identity when Terraform output not found', async () => {
      await azureDeployWorker(baseParams);

      const callArgs = rs.mocked(deployWithActivationCheck).mock.calls[0][0];
      expect(callArgs.createOptions.acrManagedIdentityId).toBeFalsy();
    });

    it('should deploy worker with worker command', async () => {
      await azureDeployWorker(baseParams);

      expect(deployWithActivationCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          createOptions: expect.objectContaining({
            command: ['node', 'dist/worker.js'],
          }),
        }),
      );
    });

    it('should pass env vars, secrets, and scaling params through', async () => {
      await azureDeployWorker(baseParams);

      expect(deployWithActivationCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          createOptions: expect.objectContaining({
            envVars: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'DB_POOL_MAX', value: '4' },
            ],
            secrets: [{ name: 'database-url', value: 'postgresql://...' }],
            secretEnvVars: [
              { name: 'DATABASE_URL', secretRef: 'database-url' },
            ],
            minReplicas: 1,
            maxReplicas: 3,
            cpu: 0.5,
            memory: '1Gi',
          }),
        }),
      );
    });

    it('should deploy worker without ingress', async () => {
      await azureDeployWorker(baseParams);

      const callArgs = rs.mocked(deployWithActivationCheck).mock.calls[0][0];
      expect(callArgs.createOptions.ingressPort).toBeUndefined();
    });

    it('should log success on completion', async () => {
      await azureDeployWorker(baseParams);

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Worker email-worker deployed successfully!',
      );
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when Terraform outputs fail', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('Not initialized');
      });

      await expect(azureDeployWorker(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw CliError when deployment fails', async () => {
      rs.mocked(deployWithActivationCheck).mockResolvedValue({
        activated: false,
        error: 'Quota exceeded',
      });

      await expect(azureDeployWorker(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });
  });
});
