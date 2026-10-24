import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockFs = {
  existsSync: rs.fn(),
};
rs.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockFs.existsSync(...args),
  },
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

const mockCheckTerraformInstalled = rs.fn();
const mockBuildGcpTerraformEnv = rs.fn(
  (_runtime: unknown, credentials: unknown) => {
    const creds = credentials as { project_id: string; region: string };
    return {
      GOOGLE_PROJECT: creds.project_id,
      GOOGLE_REGION: creds.region,
      GOOGLE_CREDENTIALS: JSON.stringify(creds),
    };
  },
);
rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: (...args: unknown[]) =>
    mockCheckTerraformInstalled(...args),
  buildGcpTerraformEnv: (runtime: unknown, credentials: unknown) =>
    mockBuildGcpTerraformEnv(runtime, credentials),
}));

const mockExecuteTerraform = rs.fn();
const mockIsCloudRunSubnetReleasePending = rs.fn();
rs.mock('../terraform', () => ({
  executeTerraform: (...args: unknown[]) => mockExecuteTerraform(...args),
  isCloudRunSubnetReleasePending: (...args: unknown[]) =>
    mockIsCloudRunSubnetReleasePending(...args),
}));

const mockDeleteEnvironmentCloudRunResources = rs.fn();
const mockGetEnvironmentCloudRunNames = rs.fn();
rs.mock('../delete', () => ({
  deleteEnvironmentCloudRunResources: (...args: unknown[]) =>
    mockDeleteEnvironmentCloudRunResources(...args),
  getEnvironmentCloudRunNames: (...args: unknown[]) =>
    mockGetEnvironmentCloudRunNames(...args),
}));

const mockInquirer = {
  prompt: rs.fn(),
};
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirer.prompt(...args),
  },
}));

import { gcpDestroy } from './destroy';
import type { GCPCommandContext } from './types';

describe('gcpDestroy', () => {
  const mockContext: GCPCommandContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      project_id: 'gcp-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'key',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockExecuteTerraform.mockResolvedValue({ success: true });
    mockInquirer.prompt.mockResolvedValue({ confirm: true });
    mockIsCloudRunSubnetReleasePending.mockReturnValue(false);
    mocks.loadFrameworkConfig.mockReset();
    mockGetEnvironmentCloudRunNames.mockReturnValue({
      services: ['auth-service', 'my-app-kong'],
      jobs: ['migrate-auth-service'],
    });
    mockDeleteEnvironmentCloudRunResources.mockResolvedValue({
      deleted: ['auth-service', 'my-app-kong', 'migrate-auth-service'],
      notFound: [],
      failed: [],
    });
  });

  describe('Cloud Run services and jobs', () => {
    it('should delete them before Terraform runs', async () => {
      const order: string[] = [];
      mockDeleteEnvironmentCloudRunResources.mockImplementation(async () => {
        order.push('cloud-run');
        return { deleted: [], notFound: [], failed: [] };
      });
      mockExecuteTerraform.mockImplementation(async (command: string) => {
        order.push(command);
        return { success: true };
      });

      await gcpDestroy(mockContext, { autoApprove: true });

      expect(order).toEqual(['cloud-run', 'init', 'destroy']);
    });

    it('should delete the names derived from the framework config', async () => {
      // No database: keeps the deletion protection step out of this test
      const services = [{ name: 'auth-service', type: 'nestjs' }];
      mocks.loadFrameworkConfig.mockReturnValue({ services });

      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mockGetEnvironmentCloudRunNames).toHaveBeenCalledWith(
        services,
        'my-app',
      );
      expect(mockDeleteEnvironmentCloudRunResources).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'gcp-project-123',
          region: 'us-central1',
          names: {
            services: ['auth-service', 'my-app-kong'],
            jobs: ['migrate-auth-service'],
          },
        }),
      );
    });

    it('should still delete Kong when the framework config cannot be read', async () => {
      mocks.loadFrameworkConfig.mockImplementation(() => {
        throw new Error('no config');
      });

      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mockGetEnvironmentCloudRunNames).toHaveBeenCalledWith(
        [],
        'my-app',
      );
    });

    it('should log each deleted resource', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Deleted auth-service',
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        '  Deleted migrate-auth-service',
      );
    });

    it('should say so when none were found', async () => {
      mockDeleteEnvironmentCloudRunResources.mockResolvedValue({
        deleted: [],
        notFound: ['auth-service'],
        failed: [],
      });

      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mocks.logger.info).toHaveBeenCalledWith('  None found.');
    });

    it('should stop before Terraform when a deletion fails', async () => {
      mockDeleteEnvironmentCloudRunResources.mockResolvedValue({
        deleted: [],
        notFound: [],
        failed: [{ name: 'auth-service', error: 'PERMISSION_DENIED' }],
      });

      await expect(
        gcpDestroy(mockContext, { autoApprove: true }),
      ).rejects.toThrow('Could not delete auth-service');
      expect(mockExecuteTerraform).not.toHaveBeenCalled();
    });

    it('should not delete anything when the user declines', async () => {
      mockInquirer.prompt.mockResolvedValue({ confirm: false });

      await gcpDestroy(mockContext, {});

      expect(mockDeleteEnvironmentCloudRunResources).not.toHaveBeenCalled();
    });
  });

  describe('subnet still held by Cloud Run', () => {
    const SUBNET_ERROR =
      '│ Error: subnetwork is already being used by serverless-ipv4-cloudrun-1, resourceInUseByAnotherResource\n';
    const USER_ERROR =
      '│ Error: failed to delete user auth-service: role cannot be dropped\n';

    it('should explain the wait and the rerun when the subnet is the only error', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, output: SUBNET_ERROR });
      mockIsCloudRunSubnetReleasePending.mockImplementation((error: string) =>
        error.includes('serverless-ipv4'),
      );

      await expect(
        gcpDestroy(mockContext, { autoApprove: true }),
      ).rejects.toThrow('The subnet is still held by Cloud Run');
    });

    it('should report a failure, with the subnet note, when other errors failed too', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({
          success: false,
          output: USER_ERROR + SUBNET_ERROR,
        });
      mockIsCloudRunSubnetReleasePending.mockImplementation((error: string) =>
        error.includes('serverless-ipv4'),
      );

      const thrown = await gcpDestroy(mockContext, { autoApprove: true }).catch(
        (error: unknown) => error,
      );

      expect(thrown).toBeInstanceOf(mocks.CliError);
      expect((thrown as Error).message).toBe('Destroy failed');
      expect((thrown as { hint?: string }).hint).toContain(
        'The subnet error clears by itself',
      );
    });

    it('should report other Terraform failures as before', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, output: 'other error' });

      await expect(
        gcpDestroy(mockContext, { autoApprove: true }),
      ).rejects.toThrow('Destroy failed');
    });
  });

  describe('directory check', () => {
    it('should check if terraform directory exists', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mockFs.existsSync).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev',
      );
    });

    it('should throw when directory does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        gcpDestroy(mockContext, { autoApprove: true }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('terraform execution', () => {
    it('should run terraform init', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'init',
        expect.objectContaining({ reconfigure: true }),
      );
    });

    it('should run terraform destroy with autoApprove', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'destroy',
        expect.objectContaining({ autoApprove: true }),
      );
    });

    it('should pass GCP credentials as env vars', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'destroy',
        expect.objectContaining({
          env: expect.objectContaining({
            GOOGLE_PROJECT: 'gcp-project-123',
            GOOGLE_REGION: 'us-central1',
          }),
        }),
      );
    });

    it('should throw when init fails', async () => {
      mockExecuteTerraform.mockResolvedValueOnce({
        success: false,
        error: 'Init failed',
      });

      await expect(
        gcpDestroy(mockContext, { autoApprove: true }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when destroy fails', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({
          success: false,
          output: '│ Error: something else failed',
          error: 'Destroy failed',
        });

      await expect(
        gcpDestroy(mockContext, { autoApprove: true }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('confirmation prompt', () => {
    it('should warn about destruction', async () => {
      await gcpDestroy(mockContext, {});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('DESTROY'),
      );
    });

    it('should prompt for confirmation when not autoApprove', async () => {
      await gcpDestroy(mockContext, {});

      expect(mockInquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'confirm',
            default: false,
          }),
        ]),
      );
    });

    it('should skip prompt when autoApprove is true', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mockInquirer.prompt).not.toHaveBeenCalled();
    });

    it('should skip prompt in CI environment', async () => {
      const ciContext = { ...mockContext, runningInCI: true };

      await gcpDestroy(ciContext, {});

      expect(mockInquirer.prompt).not.toHaveBeenCalled();
    });

    it('should cancel destroy when user declines', async () => {
      mockInquirer.prompt.mockResolvedValue({ confirm: false });

      await gcpDestroy(mockContext, {});

      expect(mockExecuteTerraform).not.toHaveBeenCalledWith(
        'destroy',
        expect.any(Object),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('cancelled'),
      );
    });
  });

  describe('logging', () => {
    it('should log project info', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mocks.logger.info).toHaveBeenCalledWith('Project: my-app');
      expect(mocks.logger.info).toHaveBeenCalledWith('Environment: dev');
    });

    it('should log success on completion', async () => {
      await gcpDestroy(mockContext, { autoApprove: true });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('destroyed successfully'),
      );
    });
  });
});
