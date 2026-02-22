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

const mockGcpInitCi = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpInitCi: (...args: unknown[]) => mockGcpInitCi(...args),
}));

const mockAwsInitCi = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsInitCi: (...args: unknown[]) => mockAwsInitCi(...args),
}));

const mockAzureInitCi = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureInitCi: (...args: unknown[]) => mockAzureInitCi(...args),
}));

import { ciInit } from './ci-init';

describe('ciInit', () => {
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

  describe('provider validation', () => {
    it('should throw when no provider flag is passed', async () => {
      await expect(ciInit({})).rejects.toThrow(mocks.CliError);
    });

    it('should throw with hint about --github flag', async () => {
      try {
        await ciInit({});
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as { hint?: string }).hint).toContain('--github');
      }
    });

    it('should accept --github flag', async () => {
      await ciInit({ github: true });

      expect(mockSetupInfraCommand).toHaveBeenCalled();
    });
  });

  describe('context setup', () => {
    it('should set up infra command', async () => {
      await ciInit({ github: true });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { github: true },
        'infra:init-ci',
      );
    });

    it('should pass env option', async () => {
      await ciInit({ github: true, env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { github: true, env: 'staging' },
        'infra:init-ci',
      );
    });
  });

  describe('provider branching', () => {
    it('should call gcpInitCi for GCP provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockGCPContext);

      await ciInit({ github: true });

      expect(mockGcpInitCi).toHaveBeenCalled();
    });

    it('should call awsInitCi for AWS provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await ciInit({ github: true });

      expect(mockAwsInitCi).toHaveBeenCalled();
    });

    it('should call azureInitCi for Azure provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await ciInit({ github: true });

      expect(mockAzureInitCi).toHaveBeenCalled();
    });

    it('should throw unsupported provider error for unknown provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockUnsupportedContext);

      await expect(ciInit({ github: true })).rejects.toThrow(mocks.CliError);
    });
  });
});
