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
const mockGcpDestroy = rs.fn();
const mockAwsDestroy = rs.fn();
const mockAzureDestroy = rs.fn();

rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/gcp/commands', () => ({
  gcpDestroy: (...args: unknown[]) => mockGcpDestroy(...args),
}));

rs.mock('../utils/aws/commands', () => ({
  awsDestroy: (...args: unknown[]) => mockAwsDestroy(...args),
}));

rs.mock('../utils/azure/commands', () => ({
  azureDestroy: (...args: unknown[]) => mockAzureDestroy(...args),
}));

import { infraDestroy } from './infra-destroy';

describe('infraDestroy', () => {
  const mockGCPCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: 'key',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: mockGCPCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockGcpDestroy.mockResolvedValue(undefined);
    mockAzureDestroy.mockResolvedValue(undefined);
  });

  describe('context setup', () => {
    it('should call setupInfraCommand with options', async () => {
      await infraDestroy({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:destroy',
      );
    });
  });

  describe('GCP provider routing', () => {
    it('should call gcpDestroy for GCP provider', async () => {
      await infraDestroy({});

      expect(mockGcpDestroy).toHaveBeenCalledWith(
        mockGCPContext,
        expect.any(Object),
      );
    });

    it('should pass autoApprove option', async () => {
      await infraDestroy({ autoApprove: true });

      expect(mockGcpDestroy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ autoApprove: true }),
      );
    });

    it('should not call gcpDestroy for non-GCP provider', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'aws',
      });

      await infraDestroy({});

      expect(mockGcpDestroy).not.toHaveBeenCalled();
    });
  });

  describe('AWS provider routing', () => {
    const mockAWSContext = {
      projectRoot: '/test/project',
      projectName: 'my-app',
      provider: 'aws' as const,
      targetEnv: 'prod',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'secret',
        accountId: '123456789012',
        region: 'us-east-1',
      },
      runningInCI: false,
    };

    it('should call awsDestroy for AWS provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDestroy({});

      expect(mockAwsDestroy).toHaveBeenCalledWith(
        mockAWSContext,
        expect.any(Object),
      );
      expect(mockGcpDestroy).not.toHaveBeenCalled();
    });

    it('should pass autoApprove option to AWS', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDestroy({ autoApprove: true });

      expect(mockAwsDestroy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ autoApprove: true }),
      );
    });
  });

  describe('Azure provider routing', () => {
    const mockAzureContext = {
      projectRoot: '/test/project',
      projectName: 'my-app',
      provider: 'azure' as const,
      targetEnv: 'prod',
      credentials: {
        subscriptionId: 'sub-123',
        tenantId: 'tenant-456',
        clientId: 'client-789',
        clientSecret: 'secret-abc',
        location: 'eastus',
      },
      runningInCI: false,
    };

    it('should call azureDestroy for Azure provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDestroy({});

      expect(mockAzureDestroy).toHaveBeenCalledWith(
        mockAzureContext,
        expect.any(Object),
      );
      expect(mockGcpDestroy).not.toHaveBeenCalled();
      expect(mockAwsDestroy).not.toHaveBeenCalled();
    });

    it('should pass autoApprove option to Azure', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDestroy({ autoApprove: true });

      expect(mockAzureDestroy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ autoApprove: true }),
      );
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'unknown',
      });

      await expect(infraDestroy({})).rejects.toThrow(mocks.CliError);
      expect(mockGcpDestroy).not.toHaveBeenCalled();
      expect(mockAwsDestroy).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log warning message for destroy', async () => {
      await infraDestroy({});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Destroying infrastructure'),
      );
    });
  });
});
