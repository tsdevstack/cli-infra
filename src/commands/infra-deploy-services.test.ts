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

import { infraDeployServices } from './infra-deploy-services';

describe('infraDeployServices', () => {
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
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockGcpDeployServices.mockResolvedValue(undefined);
    mockAwsDeployServices.mockResolvedValue(undefined);
    mockAzureDeployServices.mockResolvedValue(undefined);
  });

  describe('context setup', () => {
    it('should set up infra command', async () => {
      await infraDeployServices({});

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        {},
        'infra:deploy-services',
      );
    });
  });

  describe('GCP provider routing', () => {
    it('should call gcpDeployServices for GCP provider', async () => {
      await infraDeployServices({});

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        mockGCPContext,
        expect.any(Object),
      );
      expect(mockAwsDeployServices).not.toHaveBeenCalled();
    });

    it('should pass service option', async () => {
      await infraDeployServices({ service: 'auth-service' });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ service: 'auth-service' }),
      );
    });

    it('should pass skipGenerate option', async () => {
      await infraDeployServices({ skipGenerate: true });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ skipGenerate: true }),
      );
    });

    it('should pass tag option', async () => {
      await infraDeployServices({ tag: 'v1.0.0' });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tag: 'v1.0.0' }),
      );
    });

    it('should pass maxParallel option', async () => {
      await infraDeployServices({ maxParallel: 4 });

      expect(mockGcpDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxParallel: 4 }),
      );
    });
  });

  describe('AWS provider routing', () => {
    it('should call deployEcsServices for AWS provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDeployServices({});

      expect(mockAwsDeployServices).toHaveBeenCalledWith(
        mockAWSContext,
        expect.any(Object),
      );
      expect(mockGcpDeployServices).not.toHaveBeenCalled();
    });

    it('should pass all options to AWS', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraDeployServices({
        service: 'api',
        tag: 'v2.0.0',
        skipGenerate: true,
        maxParallel: 3,
      });

      expect(mockAwsDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          service: 'api',
          tag: 'v2.0.0',
          skipGenerate: true,
          maxParallel: 3,
        }),
      );
    });
  });

  describe('Azure provider routing', () => {
    it('should call azureDeployServices for Azure provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDeployServices({});

      expect(mockAzureDeployServices).toHaveBeenCalledWith(
        mockAzureContext,
        expect.any(Object),
      );
      expect(mockGcpDeployServices).not.toHaveBeenCalled();
      expect(mockAwsDeployServices).not.toHaveBeenCalled();
    });

    it('should pass all options to Azure', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraDeployServices({
        service: 'api',
        tag: 'v2.0.0',
        skipGenerate: true,
        maxParallel: 3,
      });

      expect(mockAzureDeployServices).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          service: 'api',
          tag: 'v2.0.0',
          skipGenerate: true,
          maxParallel: 3,
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

      await expect(infraDeployServices({})).rejects.toThrow(mocks.CliError);
      expect(mockGcpDeployServices).not.toHaveBeenCalled();
      expect(mockAwsDeployServices).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log deploying message', async () => {
      await infraDeployServices({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deploying services'),
      );
    });
  });
});
