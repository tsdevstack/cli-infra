/**
 * Tests for db-migrate-plan
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  })),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('./execute-container-job', () => ({
  executeContainerJob: rs.fn(),
}));

rs.mock('../../credentials/fetch-secret', () => ({
  fetchSecret: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: rs.fn(),
}));

import { azureDbMigratePlan } from './db-migrate-plan';
import { getTerraformOutput } from '../terraform';
import { executeContainerJob } from './execute-container-job';
import { fetchSecret } from '../../credentials/fetch-secret';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';

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
  service: { name: 'auth-service', type: 'backend' as const },
};

describe('azureDbMigratePlan', () => {
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

    rs.mocked(fetchSecret).mockReturnValue('postgres://user:pass@host:5432/db');

    rs.mocked(executeContainerJob).mockResolvedValue({
      success: true,
      logs: 'Job completed successfully',
    });
  });

  describe('Standard use cases', () => {
    it('should execute prisma migrate status command', async () => {
      await azureDbMigratePlan(baseParams);

      expect(executeContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          command: [
            'node',
            './node_modules/prisma/build/index.js',
            'migrate',
            'status',
          ],
          jobName: 'migrate-auth-service',
          image: 'myacr.azurecr.io/auth-service:latest',
        }),
      );
    });

    it('should pass DATABASE_URL env var', async () => {
      await azureDbMigratePlan(baseParams);

      expect(executeContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          envVars: [
            {
              name: 'DATABASE_URL',
              value: 'postgres://user:pass@host:5432/db',
            },
          ],
        }),
      );
    });

    it('should fetch DATABASE_URL secret directly', async () => {
      await azureDbMigratePlan(baseParams);

      expect(fetchSecret).toHaveBeenCalledWith(
        'DATABASE_URL',
        'dev',
        'auth-service',
      );
    });

    it('should log success on completion', async () => {
      await azureDbMigratePlan(baseParams);

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Migration status check completed',
      );
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when Terraform outputs fail', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('Not initialized');
      });

      await expect(azureDbMigratePlan(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw CliError when DATABASE_URL secret not found', async () => {
      rs.mocked(fetchSecret).mockReturnValue(null);

      await expect(azureDbMigratePlan(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should log error when job fails', async () => {
      rs.mocked(executeContainerJob).mockResolvedValue({
        success: false,
        logs: '',
        error: 'Job execution failed',
      });

      await azureDbMigratePlan(baseParams);

      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Migration status check failed',
      );
    });
  });
});
