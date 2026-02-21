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
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: rs.fn(),
  createOrUpdateContainerApp: rs.fn(),
  waitForContainerAppReady: rs.fn(),
}));

import { azureDeployWorker } from './deploy-worker';
import { getTerraformOutput } from '../terraform';
import {
  buildAzureTerraformEnv,
  createOrUpdateContainerApp,
  waitForContainerAppReady,
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

    rs.mocked(createOrUpdateContainerApp).mockResolvedValue({});

    rs.mocked(waitForContainerAppReady).mockResolvedValue({
      status: 'Succeeded',
    });
  });

  describe('Standard use cases', () => {
    it('should deploy worker with base service image', async () => {
      await azureDeployWorker(baseParams);

      expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          image: 'myacr.azurecr.io/auth-service:abc123',
          containerAppName: 'myapp-email-worker',
        }),
      );
    });

    it('should deploy worker with worker command', async () => {
      await azureDeployWorker(baseParams);

      expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          command: ['node', 'dist/worker.js'],
        }),
      );
    });

    it('should pass env vars, secrets, and scaling params through', async () => {
      await azureDeployWorker(baseParams);

      expect(createOrUpdateContainerApp).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
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
        }),
      );
    });

    it('should deploy worker without ingress', async () => {
      await azureDeployWorker(baseParams);

      const callArgs = rs.mocked(createOrUpdateContainerApp).mock.calls[0][1];
      expect(callArgs.ingressPort).toBeUndefined();
    });

    it('should wait for worker to be ready', async () => {
      await azureDeployWorker(baseParams);

      expect(waitForContainerAppReady).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          containerAppName: 'myapp-email-worker',
          resourceGroupName: 'myapp-dev-rg',
          timeoutMs: 300000,
        }),
      );
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

    it('should throw CliError when Container App creation fails', async () => {
      rs.mocked(createOrUpdateContainerApp).mockRejectedValue(
        new Error('Quota exceeded'),
      );

      await expect(azureDeployWorker(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw CliError when worker fails to stabilize', async () => {
      rs.mocked(waitForContainerAppReady).mockRejectedValue(
        new Error('Container App reached Failed state'),
      );

      await expect(azureDeployWorker(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });
  });
});
