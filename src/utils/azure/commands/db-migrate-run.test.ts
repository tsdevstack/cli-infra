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
  getAcrIdentityOutputs: rs.fn(),
}));

rs.mock('./execute-container-job', () => ({
  executeContainerJob: rs.fn(),
}));

rs.mock('../resolve-azure-migration-job-access', () => ({
  resolveAzureMigrationJobAccess: rs.fn(),
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
import { getTerraformOutput, getAcrIdentityOutputs } from '../terraform';
import { executeContainerJob } from './execute-container-job';
import { resolveAzureMigrationJobAccess } from '../resolve-azure-migration-job-access';
import { buildAzureTerraformEnv } from '@tsdevstack/infra-core';

const testCredentials = {
  subscriptionId: 'sub-123',
  tenantId: 'tenant-456',
  clientId: 'client-789',
  clientSecret: 'secret-abc',
  location: 'eastus',
};

const OWNER_URL_SECRET =
  'https://myapp-dev-dbjobs.vault.azure.net/secrets/myapp-auth-service-MIGRATION-DATABASE-URL';
const DB_JOBS_IDENTITY = '/subscriptions/sub/identity/myapp-dev-db-jobs';

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

    rs.mocked(getAcrIdentityOutputs).mockReturnValue({
      acrManagedIdentityId: undefined,
      managedIdentityClientId: undefined,
    });

    rs.mocked(resolveAzureMigrationJobAccess).mockResolvedValue({
      keyVaultSecretUrl: OWNER_URL_SECRET,
      identityId: DB_JOBS_IDENTITY,
    });

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

    it('should let Azure start the migration again after a failed start', async () => {
      // Safe twice at once: Prisma locks the migrations table
      await azureDbMigrateRun(baseParams);

      expect(rs.mocked(executeContainerJob).mock.calls[0][0].retries).toBe(1);
    });

    it('should have Container Apps read DATABASE_URL from Key Vault, with no value in the job', async () => {
      await azureDbMigrateRun(baseParams);

      const job = rs.mocked(executeContainerJob).mock.calls[0][0];
      expect(job.keyVaultEnvVars).toEqual([
        { name: 'DATABASE_URL', keyVaultUrl: OWNER_URL_SECRET },
      ]);
      expect(job.secretsIdentityId).toBe(DB_JOBS_IDENTITY);
      expect(job.envVars).toBeUndefined();
    });

    it('should connect as the owner role (MIGRATION_DATABASE_URL)', async () => {
      await azureDbMigrateRun(baseParams);

      expect(resolveAzureMigrationJobAccess).toHaveBeenCalledWith({
        projectName: baseParams.projectName,
        targetEnv: 'dev',
        serviceName: 'auth-service',
        credentials: baseParams.credentials,
        terraformDir: '/test/project/infrastructure/terraform/dev',
        tfEnv: { ARM_SUBSCRIPTION_ID: 'sub-123', ARM_TENANT_ID: 'tenant-456' },
      });
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

    it('should pass acrManagedIdentityId when available from Terraform output', async () => {
      rs.mocked(getAcrIdentityOutputs).mockReturnValue({
        acrManagedIdentityId: '/subscriptions/sub/identity/ca-id',
        managedIdentityClientId: undefined,
      });

      await azureDbMigrateRun(baseParams);

      expect(executeContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          acrManagedIdentityId: '/subscriptions/sub/identity/ca-id',
        }),
      );
    });

    it('should fall back to no managed identity when Terraform output not found', async () => {
      await azureDbMigrateRun(baseParams);

      const callArgs = rs.mocked(executeContainerJob).mock.calls[0][0];
      expect(callArgs.acrManagedIdentityId).toBeFalsy();
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

    it('should throw CliError when no database URL secret is found', async () => {
      rs.mocked(resolveAzureMigrationJobAccess).mockResolvedValue(null);

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
