/**
 * Tests for GCP db-migrate-run
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

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
  getTerraformOutputJson: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: rs.fn(),
  executeCloudRunJob: rs.fn(),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getMigrationJobConfig: rs.fn(() => ({ cpu: '1', memory: '2Gi' })),
}));

import { gcpDbMigrateRun } from './db-migrate-run';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import {
  buildGcpTerraformEnv,
  executeCloudRunJob,
} from '@tsdevstack/infra-core';

const testCredentials = {
  project_id: 'my-project-123',
  region: 'us-central1',
  client_email: 'sa@my-project-123.iam.gserviceaccount.com',
  private_key: 'test-key',
};

const baseParams = {
  projectRoot: '/test/project',
  targetEnv: 'dev',
  projectName: 'myapp',
  credentials: testCredentials,
  service: { name: 'auth-service', type: 'nestjs' as const, hasDatabase: true },
};

describe('gcpDbMigrateRun', () => {
  beforeEach(() => {
    rs.resetAllMocks();

    (mocks as Record<string, unknown>).buildSecretName = rs.fn(
      (project: string, scope: string, key: string) =>
        `${project}-${scope}-${key}`,
    );

    rs.mocked(buildGcpTerraformEnv).mockReturnValue({
      GOOGLE_PROJECT: 'my-project-123',
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, name: string) => {
        const outputs: Record<string, string> = {
          artifact_registry_url:
            'us-central1-docker.pkg.dev/my-project-123/myapp',
          vpc_id: 'projects/my-project-123/global/networks/vpc',
          subnet_id:
            'projects/my-project-123/regions/us-central1/subnetworks/subnet',
        };
        return outputs[name] || '';
      },
    );

    rs.mocked(getTerraformOutputJson).mockReturnValue({
      'auth-service': 'auth-sa@my-project-123.iam.gserviceaccount.com',
    });

    rs.mocked(executeCloudRunJob).mockResolvedValue({
      success: true,
      logs: 'Applied 2 migrations',
    });
  });

  describe('Standard use cases', () => {
    it('should execute Cloud Run Job with retry script command', async () => {
      await gcpDbMigrateRun(baseParams);

      expect(executeCloudRunJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          command: ['sh', '-c', expect.stringContaining('prisma')],
          jobName: 'migrate-auth-service',
          imageUri:
            'us-central1-docker.pkg.dev/my-project-123/myapp/auth-service:latest',
        }),
      );
    });

    it('should pass cpu and memory from migration job config', async () => {
      await gcpDbMigrateRun(baseParams);

      expect(executeCloudRunJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          cpu: '1',
          memory: '2Gi',
        }),
      );
    });

    it('should pass secret name and service account', async () => {
      await gcpDbMigrateRun(baseParams);

      expect(executeCloudRunJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          secretName: 'myapp-auth-service-DATABASE_URL',
          serviceAccount: 'auth-sa@my-project-123.iam.gserviceaccount.com',
        }),
      );
    });

    it('should pass VPC network and subnet', async () => {
      await gcpDbMigrateRun(baseParams);

      expect(executeCloudRunJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          vpcNetwork: 'projects/my-project-123/global/networks/vpc',
          vpcSubnet:
            'projects/my-project-123/regions/us-central1/subnetworks/subnet',
        }),
      );
    });

    it('should use custom imageTag when provided', async () => {
      await gcpDbMigrateRun({ ...baseParams, imageTag: 'v1.0.0' });

      expect(executeCloudRunJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          imageUri:
            'us-central1-docker.pkg.dev/my-project-123/myapp/auth-service:v1.0.0',
        }),
      );
    });

    it('should default to latest tag when imageTag not provided', async () => {
      await gcpDbMigrateRun(baseParams);

      expect(executeCloudRunJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          imageUri: expect.stringContaining(':latest'),
        }),
      );
    });

    it('should log success on completion', async () => {
      await gcpDbMigrateRun(baseParams);

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'Migrations applied successfully!',
      );
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when Terraform outputs fail', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('Not initialized');
      });

      await expect(gcpDbMigrateRun(baseParams)).rejects.toThrow(mocks.CliError);
    });

    it('should throw CliError when service account not found', async () => {
      rs.mocked(getTerraformOutputJson).mockReturnValue({});

      await expect(gcpDbMigrateRun(baseParams)).rejects.toThrow(mocks.CliError);
    });

    it('should throw CliError when job fails', async () => {
      rs.mocked(executeCloudRunJob).mockResolvedValue({
        success: false,
        logs: 'Migration failed: relation already exists',
      });

      await expect(gcpDbMigrateRun(baseParams)).rejects.toThrow(mocks.CliError);
    });
  });
});
