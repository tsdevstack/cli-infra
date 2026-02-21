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

const mockSelectDeployableService = rs.fn();
rs.mock('../utils/interactive', () => ({
  selectDeployableService: (...args: unknown[]) =>
    mockSelectDeployableService(...args),
}));

const mockGcpDeployServices = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpDeployServices: (...args: unknown[]) => mockGcpDeployServices(...args),
}));

const mockAwsDeployServices = rs.fn();
rs.mock('../utils/aws/commands/deploy-services', () => ({
  awsDeployServices: (...args: unknown[]) => mockAwsDeployServices(...args),
}));

const mockAzureDeployServices = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureDeployServices: (...args: unknown[]) => mockAzureDeployServices(...args),
}));

import { infraDeploySingleService } from './infra-deploy-single-service';

describe('infraDeploySingleService', () => {
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
    credentials: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'secret',
      accountId: '123456789012',
      region: 'us-east-1',
    },
    runningInCI: false,
  };

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

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.isCIEnv.mockReturnValue(false);
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockSelectDeployableService.mockResolvedValue('auth-service');
    mockGcpDeployServices.mockResolvedValue(undefined);
    mockAwsDeployServices.mockResolvedValue(undefined);
    mockAzureDeployServices.mockResolvedValue(undefined);
  });

  describe('context setup', () => {
    it('should call setupInfraCommand', async () => {
      await infraDeploySingleService('auth-service', { env: 'prod' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'prod' },
        'infra:deploy-service',
      );
    });
  });

  describe('GCP provider routing', () => {
    it('should call gcpDeployServices for GCP provider', async () => {
      await infraDeploySingleService('auth-service', { env: 'prod' });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        mockGCPContext,
        expect.objectContaining({ service: 'auth-service' }),
      );
      expect(mockAwsDeployServices).not.toHaveBeenCalled();
    });

    it('should pass skipGenerate option', async () => {
      await infraDeploySingleService('auth-service', {
        env: 'prod',
        skipGenerate: true,
      });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ skipGenerate: true }),
      );
    });

    it('should pass tag option', async () => {
      await infraDeploySingleService('auth-service', {
        env: 'prod',
        tag: 'v1.0.0',
      });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tag: 'v1.0.0' }),
      );
    });
  });

  describe('AWS provider routing', () => {
    it('should call deployEcsServices for AWS provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDeploySingleService('auth-service', { env: 'prod' });

      expect(mockAwsDeployServices).toHaveBeenCalledWith(
        mockAWSContext,
        expect.objectContaining({ service: 'auth-service' }),
      );
      expect(mockGcpDeployServices).not.toHaveBeenCalled();
    });

    it('should pass all options to AWS', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDeploySingleService('api', {
        env: 'prod',
        tag: 'v2.0.0',
        skipGenerate: true,
      });

      expect(mockAwsDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          service: 'api',
          tag: 'v2.0.0',
          skipGenerate: true,
        }),
      );
    });
  });

  describe('Azure provider routing', () => {
    it('should call azureDeployServices for Azure provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDeploySingleService('auth-service', { env: 'prod' });

      expect(mockAzureDeployServices).toHaveBeenCalledWith(
        mockAzureContext,
        expect.objectContaining({ service: 'auth-service' }),
      );
      expect(mockGcpDeployServices).not.toHaveBeenCalled();
      expect(mockAwsDeployServices).not.toHaveBeenCalled();
    });

    it('should pass all options to Azure', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDeploySingleService('api', {
        env: 'prod',
        tag: 'v2.0.0',
        skipGenerate: true,
      });

      expect(mockAzureDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          service: 'api',
          tag: 'v2.0.0',
          skipGenerate: true,
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

      await expect(
        infraDeploySingleService('auth-service', { env: 'prod' }),
      ).rejects.toThrow(mocks.CliError);
      expect(mockGcpDeployServices).not.toHaveBeenCalled();
      expect(mockAwsDeployServices).not.toHaveBeenCalled();
    });
  });

  describe('CI mode', () => {
    it('should throw when no service name in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(
        infraDeploySingleService(undefined, { env: 'prod' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should work with service name in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await infraDeploySingleService('frontend', { env: 'prod' });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ service: 'frontend' }),
      );
    });
  });

  describe('interactive selection', () => {
    it('should call selectDeployableService when no name provided', async () => {
      await infraDeploySingleService(undefined, { env: 'prod' });

      expect(mockSelectDeployableService).toHaveBeenCalled();
    });

    it('should use selected service from interactive selection', async () => {
      mockSelectDeployableService.mockResolvedValue('frontend');

      await infraDeploySingleService(undefined, { env: 'prod' });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ service: 'frontend' }),
      );
    });

    it('should not call selectDeployableService when name provided', async () => {
      await infraDeploySingleService('auth-service', { env: 'prod' });

      expect(mockSelectDeployableService).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log deploying message', async () => {
      await infraDeploySingleService('auth-service', { env: 'prod' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deploying single service'),
      );
    });
  });
});
