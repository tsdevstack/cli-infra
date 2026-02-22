import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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
rs.mock('../terraform', () => ({
  executeTerraform: (...args: unknown[]) => mockExecuteTerraform(...args),
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
        expect.any(Object),
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
        .mockResolvedValueOnce({ success: false, error: 'Destroy failed' });

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
