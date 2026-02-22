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

const mockGcpDbMigrateRun = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpDbMigrateRun: (...args: unknown[]) => mockGcpDbMigrateRun(...args),
}));

const mockAwsDbMigrateRun = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsDbMigrateRun: (...args: unknown[]) => mockAwsDbMigrateRun(...args),
}));

const mockAzureDbMigrateRun = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureDbMigrateRun: (...args: unknown[]) => mockAzureDbMigrateRun(...args),
}));

import { infraDbMigrateRun } from './infra-db-migrate-run';

describe('infraDbMigrateRun', () => {
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
    mockGcpDbMigrateRun.mockResolvedValue(undefined);
    mockAwsDbMigrateRun.mockResolvedValue(undefined);
    mockAzureDbMigrateRun.mockResolvedValue(undefined);
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
        infraDbMigrateRun({ service: 'unknown-service' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when service has no database', async () => {
      await expect(infraDbMigrateRun({ service: 'frontend' })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when terraform directory not found', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        infraDbMigrateRun({ service: 'auth-service' }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('GCP provider', () => {
    it('should call gcpDbMigrateRun', async () => {
      await infraDbMigrateRun({ service: 'auth-service' });

      expect(mockGcpDbMigrateRun).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        targetEnv: 'prod',
        projectName: 'my-app',
        credentials: mockGCPCredentials,
        service: expect.objectContaining({ name: 'auth-service' }),
      });
    });

    it('should not call AWS function', async () => {
      await infraDbMigrateRun({ service: 'auth-service' });

      expect(mockAwsDbMigrateRun).not.toHaveBeenCalled();
    });
  });

  describe('AWS provider', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);
    });

    it('should call awsDbMigrateRun', async () => {
      await infraDbMigrateRun({ service: 'auth-service' });

      expect(mockAwsDbMigrateRun).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        targetEnv: 'prod',
        projectName: 'my-app',
        credentials: mockAWSCredentials,
        service: expect.objectContaining({ name: 'auth-service' }),
      });
    });

    it('should not call GCP function', async () => {
      await infraDbMigrateRun({ service: 'auth-service' });

      expect(mockGcpDbMigrateRun).not.toHaveBeenCalled();
    });
  });

  describe('Azure provider', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);
    });

    it('should call azureDbMigrateRun', async () => {
      await infraDbMigrateRun({ service: 'auth-service' });

      expect(mockAzureDbMigrateRun).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        targetEnv: 'prod',
        projectName: 'my-app',
        credentials: mockAzureCredentials,
        service: expect.objectContaining({ name: 'auth-service' }),
      });
    });

    it('should not call GCP or AWS functions', async () => {
      await infraDbMigrateRun({ service: 'auth-service' });

      expect(mockGcpDbMigrateRun).not.toHaveBeenCalled();
      expect(mockAwsDbMigrateRun).not.toHaveBeenCalled();
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockUnsupportedContext);

      await expect(
        infraDbMigrateRun({ service: 'auth-service' }),
      ).rejects.toThrow(mocks.CliError);
    });
  });
});
