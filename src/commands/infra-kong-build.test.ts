import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const mockReadYamlFile = rs.fn();
const mockProcessCorsOrigins = rs.fn();

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    readYamlFile: (...args: unknown[]) => mockReadYamlFile(...args),
    processCorsOrigins: (...args: unknown[]) => mockProcessCorsOrigins(...args),
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
  default: {
    dump: rs.fn((obj) => JSON.stringify(obj)),
  },
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

const mockGenerateKongDockerfile = rs.fn();
rs.mock('../utils/kong/generate-kong-dockerfile', () => ({
  generateKongDockerfile: () => mockGenerateKongDockerfile(),
}));

const mockGetAzureKongRegistryInfo = rs.fn();
const mockPushAzureKongImage = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  getAzureKongRegistryInfo: (...args: unknown[]) =>
    mockGetAzureKongRegistryInfo(...args),
  pushAzureKongImage: (...args: unknown[]) => mockPushAzureKongImage(...args),
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
    mockGenerateKongDockerfile.mockReturnValue('FROM kong:3.4');
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

    it('should write Dockerfile', async () => {
      await infraKongBuild({});

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('Dockerfile'),
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
});
