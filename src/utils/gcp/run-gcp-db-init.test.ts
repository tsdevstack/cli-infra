import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockExecuteCloudRunJob, mockGetTerraformOutput } = rs.hoisted(() => ({
  mockExecuteCloudRunJob: rs.fn(),
  mockGetTerraformOutput: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  executeCloudRunJob: mockExecuteCloudRunJob,
  DB_EXPORT_JOB_TIMEOUT_SECONDS: 3600,
}));
rs.mock('./terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { runGcpDbInit } from './run-gcp-db-init';

const outputs: Record<string, string> = {
  artifact_registry_url: 'europe-west1-docker.pkg.dev/gcp-shop/shop',
  vpc_id: 'projects/gcp-shop/global/networks/shop-vpc',
  subnet_id: 'projects/gcp-shop/regions/europe-west1/subnetworks/shop-subnet',
  db_admin_password_secret: 'shop-db-admin-password',
  database_private_ip: '10.20.0.3',
  db_jobs_service_account_email:
    'shop-db-jobs@gcp-shop.iam.gserviceaccount.com',
  db_exports_bucket: 'shop-db-exports-gcp-shop',
};

const credentials = {
  project_id: 'gcp-shop',
  region: 'europe-west1',
  client_email: 'x@gcp-shop.iam.gserviceaccount.com',
  private_key: 'k',
};

const options = {
  mode: 'init' as const,
  terraformDir: '/p/infrastructure/terraform/dev',
  tfEnv: {},
  projectName: 'shop',
  targetEnv: 'dev',
  credentials,
  serviceNames: ['auth-service'],
};

describe('runGcpDbInit', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockGetTerraformOutput.mockImplementation(
      (_dir: string, name: string) => outputs[name],
    );
    mockExecuteCloudRunJob.mockResolvedValue({ success: true, logs: '' });
  });

  describe('Standard use cases', () => {
    it('should run the db-init image in the VPC as the database jobs account', async () => {
      await runGcpDbInit(options);

      expect(mockExecuteCloudRunJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId: 'gcp-shop',
          region: 'europe-west1',
          jobName: 'shop-db-init',
          imageUri: 'europe-west1-docker.pkg.dev/gcp-shop/shop/db-init:latest',
          command: ['node', 'index.js'],
          vpcNetwork: outputs.vpc_id,
          vpcSubnet: outputs.subnet_id,
          serviceAccount: outputs.db_jobs_service_account_email,
        }),
      );
    });

    it('should give the admin password from Secret Manager and no other secret', async () => {
      await runGcpDbInit(options);

      const job = mockExecuteCloudRunJob.mock.calls[0][1];
      expect(job.secretEnv).toEqual({
        DB_ADMIN_PASSWORD: 'shop-db-admin-password',
      });
      expect(job.secretName).toBeUndefined();
    });

    it('should pass the mode, the project and the services', async () => {
      await runGcpDbInit({
        ...options,
        mode: 'remove',
        serviceNames: ['offers-service'],
      });

      expect(mockExecuteCloudRunJob.mock.calls[0][1].env).toEqual({
        MODE: 'remove',
        PROJECT: 'shop',
        ENVIRONMENT: 'dev',
        GCP_PROJECT_ID: 'gcp-shop',
        DB_HOST: '10.20.0.3',
        SERVICES: '["offers-service"]',
        RUN_STARTED_AT: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it('should give a save or a restore its file, the exports bucket and 1 hour', async () => {
      for (const mode of ['export', 'restore'] as const) {
        mockExecuteCloudRunJob.mockClear();
        await runGcpDbInit({
          ...options,
          mode,
          exportFile: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
        });

        const job = mockExecuteCloudRunJob.mock.calls[0][1];
        expect(job.env).toMatchObject({
          MODE: mode,
          SERVICES: '["auth-service"]',
          EXPORT_FILE: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
          EXPORT_BUCKET: 'shop-db-exports-gcp-shop',
        });
        expect(job.timeoutSeconds).toBe(3600);
      }
    });

    it('should keep the default time limit and no file for init and remove', async () => {
      await runGcpDbInit(options);

      const job = mockExecuteCloudRunJob.mock.calls[0][1];
      expect(job.timeoutSeconds).toBeUndefined();
      expect(job.env).not.toHaveProperty('EXPORT_FILE');
      expect(job.env).not.toHaveProperty('EXPORT_BUCKET');
    });
  });

  describe('Edge cases', () => {
    it("should fail with the job's logs", async () => {
      mockExecuteCloudRunJob.mockResolvedValue({
        success: false,
        logs: 'db-init failed: permission denied',
      });

      await expect(runGcpDbInit(options)).rejects.toMatchObject({
        name: 'CliError',
        message: 'db-init (init) failed',
        hint: 'db-init failed: permission denied',
      });
    });
  });
});
