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

const mockExecSync = rs.fn();
const mockSpawn = rs.fn();
rs.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockCheckDockerInstalled = rs.fn();
const mockGetGitSha = rs.fn();
rs.mock('../utils/docker', () => ({
  checkDockerInstalled: () => mockCheckDockerInstalled(),
  getGitSha: () => mockGetGitSha(),
}));

const mockGetTerraformOutput = rs.fn();
rs.mock('../utils/gcp/terraform', () => ({
  getTerraformOutput: (...args: unknown[]) => mockGetTerraformOutput(...args),
}));

rs.mock('../utils/build-runtime', () => ({
  buildRuntime: () => ({}),
}));

const mockBuildGcpTerraformEnv = rs.fn();
const mockConfigureDockerAuth = rs.fn();
const mockBuildAwsTerraformEnv = rs.fn();
const mockConfigureEcrAuth = rs.fn();
const mockBuildAzureTerraformEnv = rs.fn();
const mockConfigureAcrAuth = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: (...args: unknown[]) =>
    mockBuildGcpTerraformEnv(...args),
  configureDockerAuth: (...args: unknown[]) => mockConfigureDockerAuth(...args),
  buildAwsTerraformEnv: (...args: unknown[]) =>
    mockBuildAwsTerraformEnv(...args),
  configureEcrAuth: (...args: unknown[]) => mockConfigureEcrAuth(...args),
  buildAzureTerraformEnv: (...args: unknown[]) =>
    mockBuildAzureTerraformEnv(...args),
  configureAcrAuth: (...args: unknown[]) => mockConfigureAcrAuth(...args),
}));

import { infraDockerPush } from './infra-docker-push';

describe('infraDockerPush', () => {
  const mockCredentials = {
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
    credentials: mockCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockFs.existsSync.mockReturnValue(true);
    mockBuildGcpTerraformEnv.mockReturnValue({
      GOOGLE_PROJECT: 'gcp-project-123',
    });
    mockGetTerraformOutput.mockReturnValue(
      'us-central1-docker.pkg.dev/gcp-project-123/my-app',
    );
    mockGetGitSha.mockReturnValue('abc123');
    mockConfigureDockerAuth.mockResolvedValue(undefined);
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs' },
        { name: 'frontend', type: 'nextjs' },
      ],
    });
  });

  describe('prerequisites', () => {
    it('should check Docker is installed', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockCheckDockerInstalled).toHaveBeenCalled();
    });

    it('should throw when terraform directory not found', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(infraDockerPush({})).rejects.toThrow(mocks.CliError);
    });

    it('should throw when artifact registry URL not available', async () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Output not found');
      });

      await expect(infraDockerPush({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('Docker authentication', () => {
    it('should configure Docker auth for Artifact Registry', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockConfigureDockerAuth).toHaveBeenCalledWith(
        mockCredentials,
        'us-central1-docker.pkg.dev',
      );
    });

    it('should skip Docker auth when skipAuth is true', async () => {
      await infraDockerPush({ parallel: false, skipAuth: true });

      expect(mockConfigureDockerAuth).not.toHaveBeenCalled();
    });
  });

  describe('service filtering', () => {
    it('should only push deployable services', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [
          { name: 'auth-service', type: 'nestjs' },
          { name: 'scripts', type: 'scripts' },
        ],
      });

      await infraDockerPush({ parallel: false });

      // Should push auth-service only (3 calls: push sha, tag latest, push latest)
      expect(mockExecSync).toHaveBeenCalledTimes(3);
    });

    it('should filter by specific service', async () => {
      await infraDockerPush({ service: 'auth-service', parallel: false });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('auth-service'),
        expect.anything(),
      );
    });

    it('should throw when service not found', async () => {
      await expect(
        infraDockerPush({ service: 'unknown', parallel: false }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('git SHA', () => {
    it('should use git SHA as default tag', async () => {
      mockGetGitSha.mockReturnValue('def456');

      await infraDockerPush({ parallel: false });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(':def456'),
        expect.anything(),
      );
    });

    it('should use custom tag when provided', async () => {
      await infraDockerPush({ tag: 'v1.0.0', parallel: false });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(':v1.0.0'),
        expect.anything(),
      );
    });
  });

  describe('push execution', () => {
    it('should push SHA-tagged image', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker push'),
        expect.anything(),
      );
    });

    it('should tag as latest', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker tag'),
        expect.anything(),
      );
    });

    it('should push latest tag', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(':latest'),
        expect.anything(),
      );
    });
  });

  describe('no deployable services', () => {
    it('should warn when no services found', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [{ name: 'scripts', type: 'scripts' }],
      });

      await infraDockerPush({ parallel: false });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No deployable services found'),
      );
    });
  });

  describe('logging', () => {
    it('should log environment info', async () => {
      await infraDockerPush({ parallel: false });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Environment: prod'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Registry:'),
      );
    });

    it('should log completion', async () => {
      await infraDockerPush({ parallel: false });

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('Pushed'),
      );
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

    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);
      mockBuildAwsTerraformEnv.mockReturnValue({
        AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      });
      mockGetTerraformOutput.mockReturnValue(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app',
      );
      mockConfigureEcrAuth.mockResolvedValue(undefined);
    });

    it('should configure ECR auth for AWS provider', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockConfigureEcrAuth).toHaveBeenCalledWith(
        expect.anything(),
        mockAWSContext.credentials,
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app',
      );
      expect(mockConfigureDockerAuth).not.toHaveBeenCalled();
    });

    it('should get ecr_repository_url from terraform', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        expect.stringContaining('terraform'),
        'ecr_repository_url',
        expect.any(Object),
      );
    });

    it('should skip ECR auth when skipAuth is true', async () => {
      await infraDockerPush({ parallel: false, skipAuth: true });

      expect(mockConfigureEcrAuth).not.toHaveBeenCalled();
    });
  });

  describe('Azure provider routing', () => {
    const azureCredentials = {
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
      credentials: azureCredentials,
      runningInCI: false,
    };

    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);
      mockBuildAzureTerraformEnv.mockReturnValue({
        ARM_SUBSCRIPTION_ID: 'sub-123',
      });
      mockGetTerraformOutput.mockReturnValue('myapp.azurecr.io');
      mockConfigureAcrAuth.mockResolvedValue(undefined);
    });

    it('should build Azure terraform env with credentials', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockBuildAzureTerraformEnv).toHaveBeenCalledWith(
        expect.anything(),
        azureCredentials,
      );
    });

    it('should get acr_login_server from terraform', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        expect.stringContaining('terraform'),
        'acr_login_server',
        expect.any(Object),
      );
    });

    it('should configure ACR auth for Azure provider', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockConfigureAcrAuth).toHaveBeenCalledWith(
        expect.anything(),
        azureCredentials,
        'myapp.azurecr.io',
      );
      expect(mockConfigureDockerAuth).not.toHaveBeenCalled();
      expect(mockConfigureEcrAuth).not.toHaveBeenCalled();
    });

    it('should use ACR registry URL in docker push commands', async () => {
      await infraDockerPush({ parallel: false });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('myapp.azurecr.io'),
        expect.anything(),
      );
    });

    it('should skip ACR auth when skipAuth is true', async () => {
      await infraDockerPush({ parallel: false, skipAuth: true });

      expect(mockConfigureAcrAuth).not.toHaveBeenCalled();
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        projectRoot: '/test/project',
        projectName: 'my-app',
        provider: 'unknown',
        targetEnv: 'prod',
        credentials: {},
        runningInCI: false,
      });

      await expect(infraDockerPush({})).rejects.toThrow(mocks.CliError);
      expect(mockConfigureDockerAuth).not.toHaveBeenCalled();
      expect(mockConfigureEcrAuth).not.toHaveBeenCalled();
    });
  });
});
