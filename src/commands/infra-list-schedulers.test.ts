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
  gcpListSchedulers: rs.fn(),
}));

rs.mock('../utils/aws/commands', () => ({
  awsListSchedulers: rs.fn(),
}));

rs.mock('../utils/azure/commands', () => ({
  azureListSchedulers: rs.fn(),
}));

import { infraListSchedulers } from './infra-list-schedulers';
import { gcpListSchedulers } from '../utils/gcp/commands';
import { awsListSchedulers } from '../utils/aws/commands';
import { azureListSchedulers } from '../utils/azure/commands';

describe('infraListSchedulers', () => {
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
    rs.mocked(gcpListSchedulers).mockResolvedValue(undefined);
  });

  describe('command setup', () => {
    it('should call setupInfraCommand with options', async () => {
      await infraListSchedulers({ env: 'prod' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'prod' },
        'infra:list-schedulers',
      );
    });
  });

  describe('GCP provider', () => {
    it('should call gcpListSchedulers for GCP provider', async () => {
      await infraListSchedulers({ env: 'prod' });

      expect(gcpListSchedulers).toHaveBeenCalledWith(mockGCPContext);
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
      rs.mocked(awsListSchedulers).mockResolvedValue(undefined);
    });

    it('should call awsListSchedulers for AWS provider', async () => {
      await infraListSchedulers({ env: 'prod' });

      expect(awsListSchedulers).toHaveBeenCalledWith(mockAWSContext);
      expect(gcpListSchedulers).not.toHaveBeenCalled();
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
      rs.mocked(azureListSchedulers).mockResolvedValue(undefined);
    });

    it('should call azureListSchedulers for Azure provider', async () => {
      await infraListSchedulers({ env: 'prod' });

      expect(azureListSchedulers).toHaveBeenCalledWith(mockAzureContext);
      expect(gcpListSchedulers).not.toHaveBeenCalled();
      expect(awsListSchedulers).not.toHaveBeenCalled();
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'unknown',
      });

      await expect(infraListSchedulers({ env: 'prod' })).rejects.toThrow(
        mocks.CliError,
      );
      expect(gcpListSchedulers).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log listing message', async () => {
      await infraListSchedulers({ env: 'prod' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Listing scheduled jobs'),
      );
    });
  });
});
