import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockExecuteContainerJob, mockGetTerraformOutput } = rs.hoisted(() => ({
  mockExecuteContainerJob: rs.fn(),
  mockGetTerraformOutput: rs.fn(),
}));

rs.mock('./commands/execute-container-job', () => ({
  executeContainerJob: mockExecuteContainerJob,
}));
rs.mock('./terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { runAzureDbInit } from './run-azure-db-init';

const outputs: Record<string, string> = {
  acr_login_server: 'shopdevacr.azurecr.io',
  resource_group_name: 'shop-dev-rg',
  container_apps_env_id:
    '/subscriptions/s/resourceGroups/shop-dev-rg/providers/Microsoft.App/managedEnvironments/shop-dev-cae',
  database_host: 'shop-dev-postgres.postgres.database.azure.com',
  db_jobs_identity_id:
    '/subscriptions/s/resourceGroups/shop-dev-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/shop-dev-db-jobs',
  db_jobs_identity_client_id: 'client-123',
  db_exports_container_url:
    'https://shopdevdbx12b937.blob.core.windows.net/db-exports',
};

const options = {
  mode: 'init' as const,
  terraformDir: '/p/infrastructure/terraform/dev',
  tfEnv: {},
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    subscriptionId: 's',
    tenantId: 't',
    clientId: 'c',
    clientSecret: 'x',
    location: 'swedencentral',
  },
  serviceNames: ['auth-service'],
  dbJobsKeyVault: 'shop-dev-dbjobs',
  serviceKeyVaults: { 'auth-service': 'shop-dev-auth-service' },
};

describe('runAzureDbInit', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockGetTerraformOutput.mockImplementation(
      (_dir: string, name: string) => outputs[name],
    );
    mockExecuteContainerJob.mockResolvedValue({ success: true, logs: '' });
  });

  describe('Standard use cases', () => {
    it("should run db-init:latest as the database jobs' identity", async () => {
      await runAzureDbInit(options);

      expect(mockExecuteContainerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceGroupName: 'shop-dev-rg',
          containerAppsEnvId: outputs.container_apps_env_id,
          jobName: 'db-init',
          image: 'shopdevacr.azurecr.io/db-init:latest',
          command: ['node', 'index.js'],
          acrLoginServer: 'shopdevacr.azurecr.io',
          acrManagedIdentityId: outputs.db_jobs_identity_id,
          // Room for the job's wait on its new Key Vault roles
          timeoutSeconds: 900,
        }),
      );
    });

    it('should give the job where everything is, and no password', async () => {
      await runAzureDbInit(options);

      const env = Object.fromEntries(
        (
          mockExecuteContainerJob.mock.calls[0][0].envVars as Array<{
            name: string;
            value: string;
          }>
        ).map(({ name, value }) => [name, value]),
      );
      expect(env).toEqual({
        MODE: 'init',
        PROJECT: 'shop',
        ENVIRONMENT: 'dev',
        DB_HOST: outputs.database_host,
        DB_ADMIN_USER: 'tsdevstack',
        DB_JOBS_KEY_VAULT: 'shop-dev-dbjobs',
        DB_ADMIN_PASSWORD_SECRET: 'db-admin-password',
        KEY_VAULTS: '{"auth-service":"shop-dev-auth-service"}',
        SERVICES: '["auth-service"]',
        AZURE_CLIENT_ID: 'client-123',
      });
    });
  });

  describe('saving and restoring', () => {
    it('should give the job the file, the container and an hour', async () => {
      await runAzureDbInit({
        ...options,
        mode: 'export',
        serviceKeyVaults: {},
        exportFile: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
      });

      const job = mockExecuteContainerJob.mock.calls[0][0];
      const env = Object.fromEntries(
        (job.envVars as Array<{ name: string; value: string }>).map(
          ({ name, value }) => [name, value],
        ),
      );
      expect(env).toMatchObject({
        MODE: 'export',
        EXPORT_FILE: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
        EXPORT_CONTAINER_URL:
          'https://shopdevdbx12b937.blob.core.windows.net/db-exports',
      });
      expect(job.timeoutSeconds).toBe(3600);
    });

    it('should leave the file settings out of the other modes', async () => {
      await runAzureDbInit(options);

      const names = (
        mockExecuteContainerJob.mock.calls[0][0].envVars as Array<{
          name: string;
        }>
      ).map(({ name }) => name);
      expect(names).not.toContain('EXPORT_FILE');
      expect(names).not.toContain('EXPORT_CONTAINER_URL');
      expect(mockGetTerraformOutput).not.toHaveBeenCalledWith(
        expect.anything(),
        'db_exports_container_url',
        expect.anything(),
      );
    });
  });

  describe('Edge cases', () => {
    it("should fail with the job's status and say where its output is", async () => {
      mockExecuteContainerJob.mockResolvedValue({
        success: false,
        logs: '',
        error: 'Job execution status: Failed',
      });

      await expect(
        runAzureDbInit({ ...options, mode: 'remove' }),
      ).rejects.toMatchObject({
        name: 'CliError',
        message: 'db-init (remove) failed: Job execution status: Failed',
        hint: expect.stringContaining(
          'ContainerAppConsoleLogs where JobName starts with "db-init-"',
        ),
      });
    });
  });
});
