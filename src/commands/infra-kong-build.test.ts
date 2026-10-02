import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const mockReadYamlFile = rs.fn();
const mockProcessCorsOrigins = rs.fn();
const mockWriteKongBuildContext = rs.fn();

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    readYamlFile: (...args: unknown[]) => mockReadYamlFile(...args),
    processCorsOrigins: (...args: unknown[]) => mockProcessCorsOrigins(...args),
    writeKongBuildContext: (...args: unknown[]) =>
      mockWriteKongBuildContext(...args),
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockFs = {
  existsSync: rs.fn(),
  mkdtempSync: rs.fn(),
  writeFileSync: rs.fn(),
  rmSync: rs.fn(),
};
rs.mock('node:fs', () => ({
  default: {
    existsSync: (path: string) => mockFs.existsSync(path),
    mkdtempSync: (...args: unknown[]) => mockFs.mkdtempSync(...args),
    writeFileSync: (...args: unknown[]) => mockFs.writeFileSync(...args),
    rmSync: (...args: unknown[]) => mockFs.rmSync(...args),
  },
}));

rs.mock('node:os', () => ({
  default: {
    tmpdir: () => '/tmp',
  },
}));

const mockExecSync = rs.fn();
rs.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

rs.mock('js-yaml', () => ({
  dump: rs.fn((obj) => JSON.stringify(obj)),
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

const mockBuildGcpTerraformEnv = rs.fn();
const mockConfigureDockerAuth = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: (...args: unknown[]) =>
    mockBuildGcpTerraformEnv(...args),
  configureDockerAuth: (...args: unknown[]) => mockConfigureDockerAuth(...args),
}));

const mockFetchSecret = rs.fn();
rs.mock('../utils/credentials/fetch-secret', () => ({
  fetchSecret: (...args: unknown[]) => mockFetchSecret(...args),
}));

const mockExtractPlaceholders = rs.fn();
rs.mock('../utils/kong/extract-placeholders', () => ({
  extractPlaceholders: (...args: unknown[]) => mockExtractPlaceholders(...args),
}));

const mockResolveEnvVarsStrict = rs.fn();
rs.mock('../utils/kong/resolve-env-vars-strict', () => ({
  resolveEnvVarsStrict: (...args: unknown[]) =>
    mockResolveEnvVarsStrict(...args),
}));

rs.mock('../utils/infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

rs.mock('../utils/infrastructure/get-kong-config', () => ({
  getKongConfig: rs.fn(() => ({
    minInstances: 0,
    maxInstances: 5,
    cpu: '1',
    memory: '512Mi',
    maxUploadSize: '10m',
  })),
}));

const mockGetAzureKongRegistryInfo = rs.fn();
const mockPushAzureKongImage = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  getAzureKongRegistryInfo: (...args: unknown[]) =>
    mockGetAzureKongRegistryInfo(...args),
  pushAzureKongImage: (...args: unknown[]) => mockPushAzureKongImage(...args),
}));

const mockGetAwsKongRegistryInfo = rs.fn();
const mockPushAwsKongImage = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  getAwsKongRegistryInfo: (...args: unknown[]) =>
    mockGetAwsKongRegistryInfo(...args),
  pushAwsKongImage: (...args: unknown[]) => mockPushAwsKongImage(...args),
}));

const mockGetAwsTerraformOutput = rs.fn();
rs.mock('../utils/aws/terraform', () => ({
  getTerraformOutput: (...args: unknown[]) =>
    mockGetAwsTerraformOutput(...args),
}));

import { infraKongBuild } from './infra-kong-build';

describe('infraKongBuild', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
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
    mockFs.mkdtempSync.mockReturnValue('/tmp/kong-build-123');
    mockBuildGcpTerraformEnv.mockReturnValue({
      GOOGLE_PROJECT: 'gcp-project-123',
    });
    mockGetTerraformOutput.mockReturnValue(
      'us-central1-docker.pkg.dev/gcp-project-123/my-app',
    );
    mockGetGitSha.mockReturnValue('abc123');
    mockConfigureDockerAuth.mockResolvedValue(undefined);
    mockReadYamlFile.mockReturnValue({
      _format_version: '3.0',
      services: [{ url: '${AUTH_SERVICE_URL}' }],
    });
    mockExtractPlaceholders.mockReturnValue(['AUTH_SERVICE_URL']);
    mockFetchSecret.mockReturnValue('https://auth-service.run.app');
    mockResolveEnvVarsStrict.mockReturnValue({
      _format_version: '3.0',
      services: [{ url: 'https://auth-service.run.app' }],
    });
    mockWriteKongBuildContext.mockReturnValue(['bundled', 'oidc']);
  });

  describe('prerequisites', () => {
    it('should check Docker is installed', async () => {
      await infraKongBuild({});

      expect(mockCheckDockerInstalled).toHaveBeenCalled();
    });

    it('should throw when Kong config not found', async () => {
      mockFs.existsSync.mockImplementation(
        (p: string) => !p.includes('kong.yml'),
      );

      await expect(infraKongBuild({})).rejects.toThrow(mocks.CliError);
    });

    it('should throw when terraform directory not found', async () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.includes('terraform')) return false;
        return true;
      });

      await expect(infraKongBuild({})).rejects.toThrow(mocks.CliError);
    });

    it('should throw when artifact registry URL not available', async () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Not found');
      });

      await expect(infraKongBuild({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('placeholder resolution', () => {
    it('should extract placeholders from config', async () => {
      await infraKongBuild({});

      expect(mockExtractPlaceholders).toHaveBeenCalled();
    });

    it('should fetch secrets for placeholders', async () => {
      mockExtractPlaceholders.mockReturnValue([
        'AUTH_SERVICE_URL',
        'OFFERS_SERVICE_URL',
      ]);
      mockFetchSecret.mockReturnValue('https://service.run.app');

      await infraKongBuild({});

      expect(mockFetchSecret).toHaveBeenCalledWith('AUTH_SERVICE_URL', 'prod');
      expect(mockFetchSecret).toHaveBeenCalledWith(
        'OFFERS_SERVICE_URL',
        'prod',
      );
    });

    it('should throw when secrets missing', async () => {
      mockFetchSecret.mockReturnValue(null);

      await expect(infraKongBuild({})).rejects.toThrow(mocks.CliError);
    });

    it('should resolve placeholders in config', async () => {
      await infraKongBuild({});

      expect(mockResolveEnvVarsStrict).toHaveBeenCalled();
    });
  });

  describe('Docker build', () => {
    it('should create temp build directory', async () => {
      await infraKongBuild({});

      expect(mockFs.mkdtempSync).toHaveBeenCalled();
    });

    it('should write the shared Kong build context with the resolved config baked in', async () => {
      await infraKongBuild({});

      expect(mockWriteKongBuildContext).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        contextDir: '/tmp/kong-build-123',
        maxUploadSize: '10m',
        kongYml: JSON.stringify({
          _format_version: '3.0',
          services: [{ url: 'https://auth-service.run.app' }],
        }),
      });
    });

    it('should build from the temporary context after staging it', async () => {
      await infraKongBuild({});

      const stageOrder =
        mockWriteKongBuildContext.mock.invocationCallOrder[0] ?? Infinity;
      const buildCall = mockExecSync.mock.calls.findIndex((call: unknown[]) =>
        String(call[0]).startsWith('docker build'),
      );
      expect(buildCall).toBeGreaterThanOrEqual(0);
      expect(mockExecSync.mock.calls[buildCall][1]).toMatchObject({
        cwd: '/tmp/kong-build-123',
      });
      expect(stageOrder).toBeLessThan(
        mockExecSync.mock.invocationCallOrder[buildCall] ?? -Infinity,
      );
    });

    it('should clean up the temp directory when staging fails (e.g. plugin name collision)', async () => {
      mockWriteKongBuildContext.mockImplementation(() => {
        throw new mocks.CliError('Kong plugin name collision');
      });

      await expect(infraKongBuild({})).rejects.toThrow(
        'Kong plugin name collision',
      );
      expect(mockFs.rmSync).toHaveBeenCalledWith('/tmp/kong-build-123', {
        recursive: true,
        force: true,
      });
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining('docker build'),
        expect.anything(),
      );
    });

    it('should build with docker', async () => {
      await infraKongBuild({});

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker build'),
        expect.anything(),
      );
    });

    it('should use linux/amd64 platform', async () => {
      await infraKongBuild({});

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--platform linux/amd64'),
        expect.anything(),
      );
    });

    it('should cleanup temp directory', async () => {
      await infraKongBuild({});

      expect(mockFs.rmSync).toHaveBeenCalledWith('/tmp/kong-build-123', {
        recursive: true,
        force: true,
      });
    });
  });

  describe('push to registry', () => {
    it('should configure Docker auth', async () => {
      await infraKongBuild({});

      expect(mockConfigureDockerAuth).toHaveBeenCalledWith(
        mockCredentials,
        'us-central1-docker.pkg.dev',
      );
    });

    it('should push image', async () => {
      await infraKongBuild({});

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker push'),
        expect.anything(),
      );
    });
  });

  describe('tagging', () => {
    it('should use git SHA as default tag', async () => {
      await infraKongBuild({});

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(':abc123'),
        expect.anything(),
      );
    });

    it('should use custom tag when provided', async () => {
      await infraKongBuild({ tag: 'v1.0.0' });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(':v1.0.0'),
        expect.anything(),
      );
    });
  });

  describe('logging', () => {
    it('should log completion', async () => {
      await infraKongBuild({});

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('Kong image built'),
      );
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
      mockGetAzureKongRegistryInfo.mockReturnValue({
        registryUrl: 'myapp.azurecr.io',
        registryHost: 'myapp.azurecr.io',
      });
      mockPushAzureKongImage.mockResolvedValue(undefined);
    });

    it('should get Azure Kong registry info', async () => {
      await infraKongBuild({});

      expect(mockGetAzureKongRegistryInfo).toHaveBeenCalledWith(
        '/test/project',
        'prod',
        azureCredentials,
      );
    });

    it('should use ACR registry URL in docker build command', async () => {
      await infraKongBuild({});

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('myapp.azurecr.io'),
        expect.anything(),
      );
    });

    it('should push SHA-tagged image to ACR', async () => {
      await infraKongBuild({});

      expect(mockPushAzureKongImage).toHaveBeenCalledWith(
        expect.stringContaining('myapp.azurecr.io/kong:abc123'),
        'myapp.azurecr.io',
        azureCredentials,
      );
    });

    it('should push latest-tagged image to ACR', async () => {
      await infraKongBuild({});

      expect(mockPushAzureKongImage).toHaveBeenCalledWith(
        expect.stringContaining('myapp.azurecr.io/kong:latest'),
        'myapp.azurecr.io',
        azureCredentials,
      );
    });
  });
  describe('AWS provider routing', () => {
    const awsCredentials = {
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      accountId: '123456789012',
    };

    const cloudMapUrls: Record<string, string> = {
      AUTH_SERVICE_URL: 'http://auth-service.my-app.local:8080',
      OFFERS_SERVICE_URL: 'http://offers-service.my-app.local:8080',
    };

    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue({
        projectRoot: '/test/project',
        projectName: 'my-app',
        provider: 'aws' as const,
        targetEnv: 'prod',
        credentials: awsCredentials,
        runningInCI: false,
      });
      mockGetAwsKongRegistryInfo.mockReturnValue({
        registryUrl: '123456789012.dkr.ecr.us-east-1.amazonaws.com',
      });
      mockPushAwsKongImage.mockResolvedValue(undefined);
      mockExtractPlaceholders.mockReturnValue(Object.keys(cloudMapUrls));
      mockFetchSecret.mockImplementation(
        (key: string) => cloudMapUrls[key] ?? null,
      );
    });

    it('should resolve service URLs from Secrets Manager (Cloud Map URLs)', async () => {
      await infraKongBuild({});

      expect(mockFetchSecret).toHaveBeenCalledWith('AUTH_SERVICE_URL', 'prod');
      expect(mockFetchSecret).toHaveBeenCalledWith(
        'OFFERS_SERVICE_URL',
        'prod',
      );
      expect(mockResolveEnvVarsStrict).toHaveBeenCalledWith(
        expect.anything(),
        cloudMapUrls,
      );
    });

    it('should not read Terraform outputs for placeholders', async () => {
      await infraKongBuild({});

      expect(mockGetAwsTerraformOutput).not.toHaveBeenCalled();
    });

    it('should fail on a placeholder missing from Secrets Manager', async () => {
      mockExtractPlaceholders.mockReturnValue([
        'AUTH_SERVICE_URL',
        'WAKEUP_LAMBDA_URL',
      ]);

      await expect(infraKongBuild({})).rejects.toThrow(mocks.CliError);
      expect(mockGetAwsTerraformOutput).not.toHaveBeenCalled();
    });

    it('should push SHA-tagged and latest images to ECR', async () => {
      await infraKongBuild({});

      expect(mockPushAwsKongImage).toHaveBeenCalledWith(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/kong:abc123',
        '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        awsCredentials,
      );
      expect(mockPushAwsKongImage).toHaveBeenCalledWith(
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/kong:latest',
        '123456789012.dkr.ecr.us-east-1.amazonaws.com',
        awsCredentials,
      );
    });
  });
});
