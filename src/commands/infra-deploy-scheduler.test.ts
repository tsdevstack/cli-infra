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

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/gcp/commands', () => ({
  gcpDeployScheduler: rs.fn(),
}));

rs.mock('../utils/aws/commands', () => ({
  awsDeployScheduler: rs.fn(),
}));

rs.mock('../utils/azure/commands', () => ({
  azureDeployScheduler: rs.fn(),
}));

import { infraDeployScheduler } from './infra-deploy-scheduler';
import { gcpDeployScheduler } from '../utils/gcp/commands';
import { awsDeployScheduler } from '../utils/aws/commands';
import { azureDeployScheduler } from '../utils/azure/commands';

describe('infraDeployScheduler', () => {
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
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    rs.mocked(gcpDeployScheduler).mockResolvedValue(undefined);
  });

  describe('command setup', () => {
    it('should call setupInfraCommand with options', async () => {
      await infraDeployScheduler({ env: 'prod' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'prod' },
        'infra:deploy-scheduler',
      );
    });
  });

  describe('GCP provider', () => {
    it('should call gcpDeployScheduler for GCP provider', async () => {
      await infraDeployScheduler({ env: 'prod' });

      expect(gcpDeployScheduler).toHaveBeenCalledWith(
        mockGCPContext,
        expect.objectContaining({
          job: undefined,
          autoApprove: undefined,
        }),
      );
    });

    it('should pass job option', async () => {
      await infraDeployScheduler({ env: 'prod', job: 'daily-cleanup' });

      expect(gcpDeployScheduler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          job: 'daily-cleanup',
        }),
      );
    });

    it('should pass autoApprove option', async () => {
      await infraDeployScheduler({ env: 'prod', autoApprove: true });

      expect(gcpDeployScheduler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          autoApprove: true,
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
      rs.mocked(awsDeployScheduler).mockResolvedValue(undefined);
    });

    it('should call awsDeployScheduler for AWS provider', async () => {
      await infraDeployScheduler({ env: 'prod' });

      expect(awsDeployScheduler).toHaveBeenCalledWith(
        mockAWSContext,
        expect.objectContaining({
          job: undefined,
          autoApprove: undefined,
        }),
      );
      expect(gcpDeployScheduler).not.toHaveBeenCalled();
    });

    it('should pass job and autoApprove options', async () => {
      await infraDeployScheduler({
        env: 'prod',
        job: 'daily-cleanup',
        autoApprove: true,
      });

      expect(awsDeployScheduler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          job: 'daily-cleanup',
          autoApprove: true,
        }),
      );
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
      rs.mocked(azureDeployScheduler).mockResolvedValue(undefined);
    });

    it('should call azureDeployScheduler for Azure provider', async () => {
      await infraDeployScheduler({ env: 'prod' });

      expect(azureDeployScheduler).toHaveBeenCalledWith(
        mockAzureContext,
        expect.objectContaining({
          job: undefined,
          autoApprove: undefined,
        }),
      );
      expect(gcpDeployScheduler).not.toHaveBeenCalled();
      expect(awsDeployScheduler).not.toHaveBeenCalled();
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'unknown',
      });

      await expect(infraDeployScheduler({ env: 'prod' })).rejects.toThrow(
        mocks.CliError,
      );
      expect(gcpDeployScheduler).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log deployment message', async () => {
      await infraDeployScheduler({ env: 'prod' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deploying scheduled job'),
      );
    });
  });
});
