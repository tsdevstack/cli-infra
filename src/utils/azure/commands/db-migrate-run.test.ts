/**
 * Tests for db-migrate-run
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

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

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getMigrationJobConfig: rs.fn(() => ({ cpu: '1', memory: '2Gi' })),
}));

import { azureDbMigrateRun } from './db-migrate-run';
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

describe('azureDbMigrateRun', () => {
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
    it('should execute prisma migrate deploy command', async () => {
      await azureDbMigrateRun(baseParams);

      expect(executeContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          command: [
            'node',
            './node_modules/prisma/build/index.js',
            'migrate',
            'deploy',
          ],
          jobName: 'migrate-auth-service',
          image: 'myacr.azurecr.io/auth-service:latest',
        }),
      );
    });

    it('should pass DATABASE_URL env var', async () => {
      await azureDbMigrateRun(baseParams);

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
      await azureDbMigrateRun(baseParams);

      expect(fetchSecret).toHaveBeenCalledWith(
        'DATABASE_URL',
        'dev',
        'auth-service',
      );
    });

    it('should log success on completion', async () => {
      await azureDbMigrateRun(baseParams);

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Database migrations applied successfully!',
      );
    });

    it('should use custom imageTag when provided', async () => {
      await azureDbMigrateRun({ ...baseParams, imageTag: 'v1.0.0' });

      expect(executeContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'myacr.azurecr.io/auth-service:v1.0.0',
        }),
      );
    });

    it('should default to latest tag when imageTag not provided', async () => {
      await azureDbMigrateRun(baseParams);

      expect(executeContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'myacr.azurecr.io/auth-service:latest',
        }),
      );
    });

    it('should pass acrLoginServer for registry auth', async () => {
      await azureDbMigrateRun(baseParams);

      expect(executeContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          acrLoginServer: 'myacr.azurecr.io',
        }),
      );
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when Terraform outputs fail', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('Not initialized');
      });

      await expect(azureDbMigrateRun(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw CliError when DATABASE_URL secret not found', async () => {
      rs.mocked(fetchSecret).mockReturnValue(null);

      await expect(azureDbMigrateRun(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw CliError when job fails', async () => {
      rs.mocked(executeContainerJob).mockResolvedValue({
        success: false,
        logs: '',
        error: 'Migration failed',
      });

      await expect(azureDbMigrateRun(baseParams)).rejects.toThrow(
        mocks.CliError,
      );
    });
  });
});
