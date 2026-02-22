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

const mockGcpGenerateCiWorkflows = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpGenerateCiWorkflows: (...args: unknown[]) =>
    mockGcpGenerateCiWorkflows(...args),
}));

const mockAwsGenerateCiWorkflows = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsGenerateCiWorkflows: (...args: unknown[]) =>
    mockAwsGenerateCiWorkflows(...args),
}));

const mockAzureGenerateCiWorkflows = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureGenerateCiWorkflows: (...args: unknown[]) =>
    mockAzureGenerateCiWorkflows(...args),
}));

import { ciGenerate } from './ci-generate';

describe('ciGenerate', () => {
  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: { project_id: 'gcp-project-123', region: 'us-central1' },
    runningInCI: false,
  };

  const mockAWSContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'aws' as const,
    targetEnv: 'prod',
    credentials: { region: 'us-east-1', accountId: '123456789012' },
    runningInCI: false,
  };

  const mockAzureContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'azure' as const,
    targetEnv: 'prod',
    credentials: { subscriptionId: 'sub-123', tenantId: 'tenant-123' },
    runningInCI: false,
  };

  const mockUnsupportedContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'unknown' as const,
    targetEnv: 'prod',
    credentials: {},
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
  });

  describe('context setup', () => {
    it('should set up infra command', async () => {
      await ciGenerate({});

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        {},
        'infra:generate-ci',
      );
    });

    it('should pass env option', async () => {
      await ciGenerate({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:generate-ci',
      );
    });
  });

  describe('provider branching', () => {
    it('should call gcpGenerateCiWorkflows for GCP provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockGCPContext);

      await ciGenerate({});

      expect(mockGcpGenerateCiWorkflows).toHaveBeenCalled();
    });

    it('should call awsGenerateCiWorkflows for AWS provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await ciGenerate({});

      expect(mockAwsGenerateCiWorkflows).toHaveBeenCalled();
    });

    it('should call azureGenerateCiWorkflows for Azure provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await ciGenerate({});

      expect(mockAzureGenerateCiWorkflows).toHaveBeenCalled();
    });

    it('should throw unsupported provider error for unknown provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockUnsupportedContext);

      await expect(ciGenerate({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('logging', () => {
    it('should log success message', async () => {
      await ciGenerate({});

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('regenerated successfully'),
      );
    });
  });
});
