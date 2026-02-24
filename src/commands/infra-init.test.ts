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
const mockGcpInit = rs.fn();
const mockAwsInit = rs.fn();
const mockAzureBootstrap = rs.fn();

rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/gcp/commands', () => ({
  gcpInit: (...args: unknown[]) => mockGcpInit(...args),
}));

rs.mock('../utils/aws/commands', () => ({
  awsInit: (...args: unknown[]) => mockAwsInit(...args),
}));

rs.mock('../utils/azure/commands', () => ({
  azureBootstrap: (...args: unknown[]) => mockAzureBootstrap(...args),
}));

const mockGenerateInfrastructureSchema = rs
  .fn()
  .mockReturnValue('{"$schema": "..."}');
rs.mock('../utils/infrastructure/generate-infrastructure-schema', () => ({
  generateInfrastructureSchema: (...args: unknown[]) =>
    mockGenerateInfrastructureSchema(...args),
}));

const mockExecuteCommand = rs.fn();

import { infraInit } from './infra-init';

describe('infraInit', () => {
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

  const mockAWSContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'aws' as const,
    targetEnv: 'prod',
    credentials: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      accountId: '123456789012',
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
      tenantId: 'tenant-123',
      clientId: 'client-123',
      clientSecret: 'secret',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.isFile.mockReturnValue(false);
    mocks.isCIEnv.mockReturnValue(false);
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      cloud: { provider: 'gcp' },
      services: [],
    });
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockGcpInit.mockResolvedValue(undefined);
    mockAwsInit.mockResolvedValue(undefined);
    mockAzureBootstrap.mockResolvedValue(undefined);
    mockGenerateInfrastructureSchema.mockReturnValue('{"$schema": "..."}');
    // Add executeCommand to mocks context
    (
      mocks as unknown as { executeCommand: typeof mockExecuteCommand }
    ).executeCommand = mockExecuteCommand;
  });

  describe('cloud provider handling', () => {
    it('should throw in CI when no provider configured', async () => {
      mocks.isCIEnv.mockReturnValue(true);
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: {},
        services: [],
      });

      await expect(infraInit({})).rejects.toThrow(mocks.CliError);
    });

    it('should run cloud:init interactively when no provider', async () => {
      mocks.loadFrameworkConfig
        .mockReturnValueOnce({
          project: { name: 'my-app' },
          cloud: {},
          services: [],
        })
        .mockReturnValueOnce({
          project: { name: 'my-app' },
          cloud: { provider: 'gcp' },
          services: [],
        });

      await infraInit({});

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'npx tsdevstack cloud:init',
        expect.any(Object),
      );
    });

    it('should throw if still no provider after cloud:init', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: {},
        services: [],
      });

      await expect(infraInit({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('infrastructure schema', () => {
    it('should generate schema if not exists', async () => {
      mocks.isFile.mockReturnValue(false);

      await infraInit({});

      expect(mockGenerateInfrastructureSchema).toHaveBeenCalled();
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('infrastructure.schema.json'),
        expect.any(String),
      );
    });

    it('should regenerate schema even if exists (to handle provider changes)', async () => {
      mocks.isFile.mockReturnValue(true);

      await infraInit({});

      // Schema is always regenerated in case provider changed
      expect(mockGenerateInfrastructureSchema).toHaveBeenCalled();
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('infrastructure.schema.json'),
        expect.any(String),
      );
    });

    it('should pass provider to schema generator', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        projectName: 'my-app',
        cloud: { provider: 'aws' },
        services: [],
      });

      await infraInit({});

      expect(mockGenerateInfrastructureSchema).toHaveBeenCalledWith('aws');
    });
  });

  describe('GCP provider routing', () => {
    it('should call gcpInit for GCP provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockGCPContext);

      await infraInit({});

      expect(mockGcpInit).toHaveBeenCalledWith(mockGCPContext);
    });
  });

  describe('AWS provider routing', () => {
    it('should call awsInit for AWS provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'aws' },
        services: [],
      });
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraInit({});

      expect(mockAwsInit).toHaveBeenCalledWith(mockAWSContext);
    });
  });

  describe('Azure provider routing', () => {
    it('should call azureBootstrap for Azure provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'azure' },
        services: [],
      });
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await infraInit({});

      expect(mockAzureBootstrap).toHaveBeenCalledWith(mockAzureContext);
    });
  });

  describe('context setup', () => {
    it('should pass env option to setupInfraCommand', async () => {
      await infraInit({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:init',
      );
    });
  });

  describe('logging', () => {
    it('should log initializing message', async () => {
      await infraInit({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initializing infrastructure'),
      );
    });

    it('should log CI mode when running in CI', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await infraInit({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('CI mode'),
      );
    });
  });
});
