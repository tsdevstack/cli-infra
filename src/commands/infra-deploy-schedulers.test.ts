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
  gcpDeploySchedulers: rs.fn(),
}));

rs.mock('../utils/aws/commands', () => ({
  awsDeploySchedulers: rs.fn(),
}));

rs.mock('../utils/azure/commands', () => ({
  azureDeploySchedulers: rs.fn(),
}));

import { infraDeploySchedulers } from './infra-deploy-schedulers';
import { gcpDeploySchedulers } from '../utils/gcp/commands';
import { awsDeploySchedulers } from '../utils/aws/commands';
import { azureDeploySchedulers } from '../utils/azure/commands';

describe('infraDeploySchedulers', () => {
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
    rs.mocked(gcpDeploySchedulers).mockResolvedValue(undefined);
  });

  describe('command setup', () => {
    it('should call setupInfraCommand with options', async () => {
      await infraDeploySchedulers({ env: 'prod' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'prod' },
        'infra:deploy-schedulers',
      );
    });
  });

  describe('GCP provider', () => {
    it('should call gcpDeploySchedulers for GCP provider', async () => {
      await infraDeploySchedulers({ env: 'prod' });

      expect(gcpDeploySchedulers).toHaveBeenCalledWith(
        mockGCPContext,
        expect.objectContaining({
          autoApprove: undefined,
        }),
      );
    });

    it('should pass autoApprove option', async () => {
      await infraDeploySchedulers({ env: 'prod', autoApprove: true });

      expect(gcpDeploySchedulers).toHaveBeenCalledWith(
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
      rs.mocked(awsDeploySchedulers).mockResolvedValue(undefined);
    });

    it('should call awsDeploySchedulers for AWS provider', async () => {
      await infraDeploySchedulers({ env: 'prod' });

      expect(awsDeploySchedulers).toHaveBeenCalledWith(
        mockAWSContext,
        expect.objectContaining({
          autoApprove: undefined,
        }),
      );
      expect(gcpDeploySchedulers).not.toHaveBeenCalled();
    });

    it('should pass autoApprove option', async () => {
      await infraDeploySchedulers({ env: 'prod', autoApprove: true });

      expect(awsDeploySchedulers).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
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
      rs.mocked(azureDeploySchedulers).mockResolvedValue(undefined);
    });

    it('should call azureDeploySchedulers for Azure provider', async () => {
      await infraDeploySchedulers({ env: 'prod' });

      expect(azureDeploySchedulers).toHaveBeenCalledWith(
        mockAzureContext,
        expect.objectContaining({
          autoApprove: undefined,
        }),
      );
      expect(gcpDeploySchedulers).not.toHaveBeenCalled();
      expect(awsDeploySchedulers).not.toHaveBeenCalled();
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'unknown',
      });

      await expect(infraDeploySchedulers({ env: 'prod' })).rejects.toThrow(
        mocks.CliError,
      );
      expect(gcpDeploySchedulers).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log deployment message', async () => {
      await infraDeploySchedulers({ env: 'prod' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deploying all scheduled jobs'),
      );
    });
  });
});
