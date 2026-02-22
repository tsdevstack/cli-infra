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
const mockGcpDeploy = rs.fn();
const mockAwsDeploy = rs.fn();
const mockAzureDeploy = rs.fn();

rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/gcp/commands', () => ({
  gcpDeploy: (...args: unknown[]) => mockGcpDeploy(...args),
}));

rs.mock('../utils/aws/commands', () => ({
  awsDeploy: (...args: unknown[]) => mockAwsDeploy(...args),
}));

rs.mock('../utils/azure/commands', () => ({
  azureDeploy: (...args: unknown[]) => mockAzureDeploy(...args),
}));

import { infraDeploy } from './infra-deploy';

describe('infraDeploy', () => {
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
    mockGcpDeploy.mockResolvedValue(undefined);
    mockAwsDeploy.mockResolvedValue(undefined);
    mockAzureDeploy.mockResolvedValue(undefined);
  });

  describe('context setup', () => {
    it('should call setupInfraCommand with options', async () => {
      await infraDeploy({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:deploy',
      );
    });

    it('should pass command name for telemetry', async () => {
      await infraDeploy({});

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        expect.anything(),
        'infra:deploy',
      );
    });
  });

  describe('GCP provider routing', () => {
    it('should call gcpDeploy for GCP provider', async () => {
      await infraDeploy({});

      expect(mockGcpDeploy).toHaveBeenCalledWith(
        mockGCPContext,
        expect.any(Object),
      );
    });

    it('should pass autoApprove option', async () => {
      await infraDeploy({ autoApprove: true });

      expect(mockGcpDeploy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ autoApprove: true }),
      );
    });

    it('should pass infraOnly option', async () => {
      await infraDeploy({ infraOnly: true });

      expect(mockGcpDeploy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ infraOnly: true }),
      );
    });

    it('should pass tag option', async () => {
      await infraDeploy({ tag: 'v1.0.0' });

      expect(mockGcpDeploy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tag: 'v1.0.0' }),
      );
    });

    it('should not call gcpDeploy for non-GCP provider', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'aws',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'secret',
          accountId: '123456789012',
          region: 'us-east-1',
        },
      });

      await infraDeploy({});

      expect(mockGcpDeploy).not.toHaveBeenCalled();
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
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        accountId: '123456789012',
        region: 'us-east-1',
      },
      runningInCI: false,
    };

    it('should call awsDeploy for AWS provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDeploy({});

      expect(mockAwsDeploy).toHaveBeenCalledWith(
        mockAWSContext,
        expect.any(Object),
      );
      expect(mockGcpDeploy).not.toHaveBeenCalled();
    });

    it('should pass all options to awsDeploy', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDeploy({ autoApprove: true, infraOnly: true, tag: 'v2.0.0' });

      expect(mockAwsDeploy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          autoApprove: true,
          infraOnly: true,
          tag: 'v2.0.0',
        }),
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

    it('should call azureDeploy for Azure provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDeploy({});

      expect(mockAzureDeploy).toHaveBeenCalledWith(
        mockAzureContext,
        expect.any(Object),
      );
      expect(mockGcpDeploy).not.toHaveBeenCalled();
      expect(mockAwsDeploy).not.toHaveBeenCalled();
    });

    it('should pass all options to azureDeploy', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDeploy({
        autoApprove: true,
        infraOnly: true,
        tag: 'v3.0.0',
        forceUnlock: true,
      });

      expect(mockAzureDeploy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          autoApprove: true,
          infraOnly: true,
          tag: 'v3.0.0',
          forceUnlock: true,
        }),
      );
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'unknown',
      });

      await expect(infraDeploy({})).rejects.toThrow(mocks.CliError);
      expect(mockGcpDeploy).not.toHaveBeenCalled();
      expect(mockAwsDeploy).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log deploying message', async () => {
      await infraDeploy({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deploying infrastructure'),
      );
    });
  });
});
