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

const mockFs = {
  existsSync: rs.fn(),
};
rs.mock('node:fs', () => ({
  default: {
    existsSync: (path: string) => mockFs.existsSync(path),
  },
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockGcpDbMigratePlan = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpDbMigratePlan: (...args: unknown[]) => mockGcpDbMigratePlan(...args),
}));

const mockAwsDbMigratePlan = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsDbMigratePlan: (...args: unknown[]) => mockAwsDbMigratePlan(...args),
}));

const mockAzureDbMigratePlan = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureDbMigratePlan: (...args: unknown[]) => mockAzureDbMigratePlan(...args),
}));

import { infraDbMigratePlan } from './infra-db-migrate-plan';

describe('infraDbMigratePlan', () => {
  const mockGCPCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
  };

  const mockAWSCredentials = {
    region: 'us-east-1',
    accountId: '123456789012',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: mockGCPCredentials,
    runningInCI: false,
  };

  const mockAWSContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'aws' as const,
    targetEnv: 'prod',
    credentials: mockAWSCredentials,
    runningInCI: false,
  };

  const mockAzureCredentials = {
    subscriptionId: 'sub-123',
    tenantId: 'tenant-456',
    clientId: 'client-789',
    clientSecret: 'secret-abc',
    location: 'eastus',
  };

  const mockAzureContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'azure' as const,
    targetEnv: 'prod',
    credentials: mockAzureCredentials,
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
    mockFs.existsSync.mockReturnValue(true);
    mockGcpDbMigratePlan.mockResolvedValue(undefined);
    mockAwsDbMigratePlan.mockResolvedValue(undefined);
    mockAzureDbMigratePlan.mockResolvedValue(undefined);
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
      ],
    });
  });

  describe('validation', () => {
    it('should throw when service not found', async () => {
      await expect(
        infraDbMigratePlan({ service: 'unknown-service' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when service has no database', async () => {
      await expect(infraDbMigratePlan({ service: 'frontend' })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when terraform directory not found', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        infraDbMigratePlan({ service: 'auth-service' }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('GCP provider', () => {
    it('should call gcpDbMigratePlan', async () => {
      await infraDbMigratePlan({ service: 'auth-service' });

      expect(mockGcpDbMigratePlan).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        targetEnv: 'prod',
        projectName: 'my-app',
        credentials: mockGCPCredentials,
        service: expect.objectContaining({ name: 'auth-service' }),
      });
    });

    it('should not call AWS function', async () => {
      await infraDbMigratePlan({ service: 'auth-service' });

      expect(mockAwsDbMigratePlan).not.toHaveBeenCalled();
    });
  });

  describe('AWS provider', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);
    });

    it('should call awsDbMigratePlan', async () => {
      await infraDbMigratePlan({ service: 'auth-service' });

      expect(mockAwsDbMigratePlan).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        targetEnv: 'prod',
        projectName: 'my-app',
        credentials: mockAWSCredentials,
        service: expect.objectContaining({ name: 'auth-service' }),
      });
    });

    it('should not call GCP function', async () => {
      await infraDbMigratePlan({ service: 'auth-service' });

      expect(mockGcpDbMigratePlan).not.toHaveBeenCalled();
    });
  });

  describe('Azure provider', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);
    });

    it('should call azureDbMigratePlan', async () => {
      await infraDbMigratePlan({ service: 'auth-service' });

      expect(mockAzureDbMigratePlan).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        targetEnv: 'prod',
        projectName: 'my-app',
        credentials: mockAzureCredentials,
        service: expect.objectContaining({ name: 'auth-service' }),
      });
    });

    it('should not call GCP or AWS functions', async () => {
      await infraDbMigratePlan({ service: 'auth-service' });

      expect(mockGcpDbMigratePlan).not.toHaveBeenCalled();
      expect(mockAwsDbMigratePlan).not.toHaveBeenCalled();
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockUnsupportedContext);

      await expect(
        infraDbMigratePlan({ service: 'auth-service' }),
      ).rejects.toThrow(mocks.CliError);
    });
  });
});
