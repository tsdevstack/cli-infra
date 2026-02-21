import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/gcp/commands', () => ({
  gcpRemoveScheduler: rs.fn(),
}));

rs.mock('../utils/aws/commands', () => ({
  awsRemoveScheduler: rs.fn(),
}));

rs.mock('../utils/azure/commands', () => ({
  azureRemoveScheduler: rs.fn(),
}));

import { infraRemoveScheduler } from './infra-remove-scheduler';
import { gcpRemoveScheduler } from '../utils/gcp/commands';
import { awsRemoveScheduler } from '../utils/aws/commands';
import { azureRemoveScheduler } from '../utils/azure/commands';

describe('infraRemoveScheduler', () => {
  const mockGCPContext = {
    provider: 'gcp',
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'prod',
    credentials: {
      project_id: 'gcp-project-123',
      region: 'us-central1',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.isCIEnv.mockReturnValue(false);
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    rs.mocked(gcpRemoveScheduler).mockResolvedValue(undefined);
    rs.mocked(awsRemoveScheduler).mockResolvedValue(undefined);
  });

  describe('CI mode validation', () => {
    it('should throw when --confirm flag missing in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(
        infraRemoveScheduler({ job: 'cleanup-tokens' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when --job flag missing in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(infraRemoveScheduler({ confirm: true })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should work with both flags in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await infraRemoveScheduler({
        env: 'prod',
        job: 'cleanup-tokens',
        confirm: true,
      });

      expect(gcpRemoveScheduler).toHaveBeenCalled();
    });
  });

  describe('GCP provider', () => {
    it('should call gcpRemoveScheduler for GCP provider', async () => {
      await infraRemoveScheduler({
        env: 'prod',
        job: 'cleanup-tokens',
      });

      expect(gcpRemoveScheduler).toHaveBeenCalledWith(
        mockGCPContext,
        expect.objectContaining({
          job: 'cleanup-tokens',
        }),
      );
    });

    it('should pass confirm option', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await infraRemoveScheduler({
        env: 'prod',
        job: 'cleanup-tokens',
        confirm: true,
      });

      expect(gcpRemoveScheduler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          job: 'cleanup-tokens',
          confirm: true,
        }),
      );
    });
  });

  describe('AWS provider', () => {
    const mockAWSContext = {
      ...mockGCPContext,
      provider: 'aws',
      credentials: {
        accountId: '123456789012',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'us-east-1',
      },
    };

    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);
    });

    it('should call awsRemoveScheduler for AWS provider', async () => {
      await infraRemoveScheduler({
        env: 'prod',
        job: 'my-app-auth-service-cleanup-tokens',
      });

      expect(awsRemoveScheduler).toHaveBeenCalledWith(
        mockAWSContext,
        expect.objectContaining({
          job: 'my-app-auth-service-cleanup-tokens',
        }),
      );
      expect(gcpRemoveScheduler).not.toHaveBeenCalled();
    });
  });

  describe('Azure provider', () => {
    const mockAzureContext = {
      ...mockGCPContext,
      provider: 'azure',
      credentials: {
        subscriptionId: 'sub-123',
        tenantId: 'tenant-456',
        clientId: 'client-789',
        clientSecret: 'secret-abc',
        location: 'eastus',
      },
    };

    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);
      rs.mocked(azureRemoveScheduler).mockResolvedValue(undefined);
    });

    it('should call azureRemoveScheduler for Azure provider', async () => {
      await infraRemoveScheduler({
        env: 'prod',
        job: 'cleanup-tokens',
      });

      expect(azureRemoveScheduler).toHaveBeenCalledWith(
        mockAzureContext,
        expect.objectContaining({
          job: 'cleanup-tokens',
        }),
      );
      expect(gcpRemoveScheduler).not.toHaveBeenCalled();
      expect(awsRemoveScheduler).not.toHaveBeenCalled();
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'unknown',
      });

      await expect(
        infraRemoveScheduler({ env: 'prod', job: 'cleanup-tokens' }),
      ).rejects.toThrow(mocks.CliError);
      expect(gcpRemoveScheduler).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log remove message', async () => {
      await infraRemoveScheduler({ env: 'prod', job: 'cleanup-tokens' });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Remove Scheduled Job'),
      );
    });
  });
});
