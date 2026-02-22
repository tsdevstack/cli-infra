import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockInquirerPrompt = rs.fn();
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirerPrompt(...args),
  },
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockDiscoverDeployedServices = rs.fn();
rs.mock('../utils/gcp/discovery', () => ({
  discoverDeployedServices: (...args: unknown[]) =>
    mockDiscoverDeployedServices(...args),
}));

const mockDeleteCloudRunService = rs.fn();
rs.mock('../utils/gcp/delete', () => ({
  deleteCloudRunService: (...args: unknown[]) =>
    mockDeleteCloudRunService(...args),
}));

const mockAzureRemoveDetachedWorker = rs.fn();
const mockSelectWorkerInteractiveAzure = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureRemoveDetachedWorker: (...args: unknown[]) =>
    mockAzureRemoveDetachedWorker(...args),
  selectWorkerInteractiveAzure: (...args: unknown[]) =>
    mockSelectWorkerInteractiveAzure(...args),
}));

import { infraRemoveDetachedWorker } from './infra-remove-detached-worker';

describe('infraRemoveDetachedWorker', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: mockCredentials,
    runningInCI: false,
  };

  const azureCredentials = {
    subscriptionId: 'sub-123',
    tenantId: 'tenant-456',
    clientId: 'client-789',
    clientSecret: 'secret-abc',
    location: 'eastus',
  };

  const mockAzureContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'azure' as const,
    targetEnv: 'prod',
    credentials: azureCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.isCIEnv.mockReturnValue(false);
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockDeleteCloudRunService.mockResolvedValue({
      success: true,
      deleted: true,
    });
    mockAzureRemoveDetachedWorker.mockResolvedValue(undefined);
    mockSelectWorkerInteractiveAzure.mockResolvedValue('auth-worker');
    mockInquirerPrompt.mockResolvedValue({ confirmed: true });
  });

  describe('CI mode validation', () => {
    it('should throw when --confirm flag missing in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(
        infraRemoveDetachedWorker({ worker: 'auth-worker' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when --worker flag missing in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(
        infraRemoveDetachedWorker({ confirm: true }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should work with both flags in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await infraRemoveDetachedWorker({
        env: 'prod',
        worker: 'auth-worker',
        confirm: true,
      });

      expect(mockDeleteCloudRunService).toHaveBeenCalled();
    });
  });

  describe('with worker name provided', () => {
    it('should delete specified worker', async () => {
      await infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' });

      expect(mockDeleteCloudRunService).toHaveBeenCalledWith({
        serviceName: 'auth-worker',
        projectId: 'gcp-project-123',
        region: 'us-central1',
        credentials: mockCredentials,
      });
    });
  });

  describe('interactive selection', () => {
    beforeEach(() => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          { name: 'auth-worker' },
          { name: 'email-worker' },
          { name: 'auth-service' },
        ],
      });
      mockInquirerPrompt
        .mockResolvedValueOnce({ selectedWorker: 'auth-worker' })
        .mockResolvedValueOnce({ confirmed: true });
    });

    it('should discover deployed workers', async () => {
      await infraRemoveDetachedWorker({ env: 'prod' });

      expect(mockDiscoverDeployedServices).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'my-app',
          projectId: 'gcp-project-123',
        }),
      );
    });

    it('should filter to only -worker services', async () => {
      await infraRemoveDetachedWorker({ env: 'prod' });

      const promptCall = mockInquirerPrompt.mock.calls[0][0][0];
      const choices = promptCall.choices;

      // Should have auth-worker, email-worker, and manual entry (not auth-service)
      expect(choices).toEqual([
        { name: 'auth-worker', value: 'auth-worker' },
        { name: 'email-worker', value: 'email-worker' },
        { name: '[ Enter worker name manually ]', value: '__manual__' },
      ]);
    });

    it('should throw when no workers found', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [{ name: 'auth-service' }],
      });

      await expect(infraRemoveDetachedWorker({ env: 'prod' })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when discovery fails', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: false,
        error: 'API error',
      });

      await expect(infraRemoveDetachedWorker({ env: 'prod' })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should support manual entry', async () => {
      mockInquirerPrompt.mockReset();
      mockInquirerPrompt
        .mockResolvedValueOnce({ selectedWorker: '__manual__' })
        .mockResolvedValueOnce({ enteredWorkerName: 'custom-worker' })
        .mockResolvedValueOnce({ confirmed: true });

      await infraRemoveDetachedWorker({ env: 'prod' });

      expect(mockDeleteCloudRunService).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'custom-worker',
        }),
      );
    });
  });

  describe('confirmation prompt', () => {
    it('should prompt for confirmation in interactive mode', async () => {
      mockInquirerPrompt.mockResolvedValue({ confirmed: true });

      await infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' });

      expect(mockInquirerPrompt).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'confirm',
          name: 'confirmed',
          message: expect.stringContaining('auth-worker'),
        }),
      ]);
    });

    it('should abort when user declines', async () => {
      mockInquirerPrompt.mockResolvedValue({ confirmed: false });

      await infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' });

      expect(mockDeleteCloudRunService).not.toHaveBeenCalled();
    });
  });

  describe('deletion', () => {
    it('should throw when deletion fails', async () => {
      mockDeleteCloudRunService.mockResolvedValue({
        success: false,
        error: 'Permission denied',
      });

      await expect(
        infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should handle already deleted worker', async () => {
      mockDeleteCloudRunService.mockResolvedValue({
        success: true,
        deleted: false,
      });

      await infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
      );
    });
  });

  describe('logging', () => {
    it('should log worker info', async () => {
      await infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Worker: auth-worker'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Environment: prod'),
      );
    });

    it('should log success message', async () => {
      await infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('removed from prod'),
      );
    });
  });

  describe('Azure provider routing', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);
    });

    it('should call azureRemoveDetachedWorker with correct params', async () => {
      await infraRemoveDetachedWorker({ env: 'prod', worker: 'auth-worker' });

      expect(mockAzureRemoveDetachedWorker).toHaveBeenCalledWith({
        workerName: 'auth-worker',
        projectName: 'my-app',
        targetEnv: 'prod',
        credentials: azureCredentials,
      });
      expect(mockDeleteCloudRunService).not.toHaveBeenCalled();
    });

    it('should use selectWorkerInteractiveAzure for interactive discovery', async () => {
      mockSelectWorkerInteractiveAzure.mockResolvedValue('email-worker');
      mockInquirerPrompt.mockResolvedValue({ confirmed: true });

      await infraRemoveDetachedWorker({ env: 'prod' });

      expect(mockSelectWorkerInteractiveAzure).toHaveBeenCalledWith(
        azureCredentials,
        'my-app',
        'prod',
      );
      expect(mockAzureRemoveDetachedWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          workerName: 'email-worker',
        }),
      );
    });

    it('should not call GCP discovery for Azure provider', async () => {
      await infraRemoveDetachedWorker({ env: 'prod' });

      expect(mockDiscoverDeployedServices).not.toHaveBeenCalled();
    });
  });
});
