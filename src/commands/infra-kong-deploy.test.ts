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

const mockFs = {
  existsSync: rs.fn(),
};
rs.mock('node:fs', () => ({
  default: {
    existsSync: (path: string) => mockFs.existsSync(path),
  },
}));

const mockGetTerraformOutput = rs.fn();
const mockGetTerraformOutputJson = rs.fn();
rs.mock('../utils/gcp/terraform', () => ({
  getTerraformOutput: (...args: unknown[]) => mockGetTerraformOutput(...args),
  getTerraformOutputJson: (...args: unknown[]) =>
    mockGetTerraformOutputJson(...args),
}));

rs.mock('../utils/build-runtime', () => ({
  buildRuntime: () => ({}),
}));

const mockGetGitSha = rs.fn();
rs.mock('../utils/docker', () => ({
  getGitSha: () => mockGetGitSha(),
}));

const mockDeployKongCloudRun = rs.fn();
rs.mock('../utils/gcp/deploy-kong-cloud-run', () => ({
  deployKongCloudRun: (...args: unknown[]) => mockDeployKongCloudRun(...args),
}));

const mockBuildGcpTerraformEnv = rs.fn();
const mockWaitForImage = rs.fn();
const mockSetServiceInvokerPolicy = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: (...args: unknown[]) =>
    mockBuildGcpTerraformEnv(...args),
  waitForImage: (...args: unknown[]) => mockWaitForImage(...args),
  setServiceInvokerPolicy: (...args: unknown[]) =>
    mockSetServiceInvokerPolicy(...args),
}));

const mockSetSecretViaCli = rs.fn();
rs.mock('../utils/credentials/set-secret-via-cli', () => ({
  setSecretViaCli: (...args: unknown[]) => mockSetSecretViaCli(...args),
}));

const mockAzureKongDeploy = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureKongDeploy: (...args: unknown[]) => mockAzureKongDeploy(...args),
}));

rs.mock('../utils/infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

const mockGetKongConfig = rs.fn();
rs.mock('../utils/infrastructure/merge-with-defaults', () => ({
  getKongConfig: (...args: unknown[]) => mockGetKongConfig(...args),
}));

import { infraKongDeploy } from './infra-kong-deploy';

describe('infraKongDeploy', () => {
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
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockFs.existsSync.mockReturnValue(true);
    mockBuildGcpTerraformEnv.mockReturnValue({
      GOOGLE_PROJECT: 'gcp-project-123',
    });
    mockGetTerraformOutput.mockImplementation((_dir: string, name: string) => {
      if (name === 'artifact_registry_url')
        return 'us-central1-docker.pkg.dev/gcp-project-123/my-app';
      if (name === 'vpc_id')
        return 'projects/gcp-project-123/global/networks/vpc';
      if (name === 'subnet_id')
        return 'projects/gcp-project-123/regions/us-central1/subnetworks/subnet';
      if (name === 'kong_service_account_email')
        return 'kong-sa@gcp-project-123.iam.gserviceaccount.com';
      return '';
    });
    mockGetTerraformOutputJson.mockReturnValue({
      kong: 'kong-sa@gcp-project-123.iam.gserviceaccount.com',
    });
    mockGetKongConfig.mockReturnValue({
      minInstances: 1,
      maxInstances: 10,
      cpu: '2',
      memory: '1Gi',
    });
    mockAzureKongDeploy.mockResolvedValue(undefined);
    mockGetGitSha.mockReturnValue('abc123');
    mockWaitForImage.mockResolvedValue(undefined);
    mockDeployKongCloudRun.mockResolvedValue({
      success: true,
      serviceUrl: 'https://kong-abc123.run.app',
    });
  });

  describe('terraform directory validation', () => {
    it('should throw when terraform directory does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(infraKongDeploy({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('terraform outputs', () => {
    it('should throw when terraform outputs cannot be retrieved', async () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Output not found');
      });

      await expect(infraKongDeploy({})).rejects.toThrow(mocks.CliError);
    });

    it('should fall back to runtime SA map when kong-specific SA not found', async () => {
      mockGetTerraformOutput.mockImplementation(
        (_dir: string, name: string) => {
          if (name === 'artifact_registry_url') return 'registry-url';
          if (name === 'vpc_id') return 'vpc-id';
          if (name === 'subnet_id') return 'subnet-id';
          if (name === 'kong_service_account_email')
            throw new Error('Not found');
          return '';
        },
      );
      mockGetTerraformOutputJson.mockReturnValue({
        kong: 'kong-fallback@gcp.iam.gserviceaccount.com',
      });

      await infraKongDeploy({});

      expect(mockDeployKongCloudRun).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceAccount: 'kong-fallback@gcp.iam.gserviceaccount.com',
        }),
      );
    });

    it('should throw when no service account available for Kong', async () => {
      mockGetTerraformOutput.mockImplementation(
        (_dir: string, name: string) => {
          if (name === 'artifact_registry_url') return 'registry-url';
          if (name === 'vpc_id') return 'vpc-id';
          if (name === 'subnet_id') return 'subnet-id';
          if (name === 'kong_service_account_email')
            throw new Error('Not found');
          return '';
        },
      );
      mockGetTerraformOutputJson.mockReturnValue({});

      await expect(infraKongDeploy({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('image verification', () => {
    it('should verify image exists before deployment', async () => {
      await infraKongDeploy({});

      expect(mockWaitForImage).toHaveBeenCalledWith(expect.anything(), {
        imageUri: expect.stringContaining('kong:abc123'),
        credentials: mockCredentials,
      });
    });

    it('should use provided tag option', async () => {
      await infraKongDeploy({ tag: 'v2.0.0' });

      expect(mockWaitForImage).toHaveBeenCalledWith(expect.anything(), {
        imageUri: expect.stringContaining('kong:v2.0.0'),
        credentials: mockCredentials,
      });
    });
  });

  describe('Kong deployment', () => {
    it('should deploy Kong with correct configuration', async () => {
      await infraKongDeploy({});

      expect(mockDeployKongCloudRun).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'gcp-project-123',
          projectName: 'my-app',
          region: 'us-central1',
          minInstances: 1,
          maxInstances: 10,
          cpu: '2',
          memory: '1Gi',
        }),
      );
    });

    it('should use VPC network and subnet', async () => {
      await infraKongDeploy({});

      expect(mockDeployKongCloudRun).toHaveBeenCalledWith(
        expect.objectContaining({
          vpcNetwork: expect.stringContaining('vpc'),
          vpcSubnet: expect.stringContaining('subnet'),
        }),
      );
    });
  });

  describe('KONG_INTERNAL_URL sync', () => {
    it('should save KONG_INTERNAL_URL to Secret Manager on success', async () => {
      mockDeployKongCloudRun.mockResolvedValue({
        success: true,
        serviceUrl: 'https://kong-xyz.run.app',
      });

      await infraKongDeploy({});

      expect(mockSetSecretViaCli).toHaveBeenCalledWith(
        'KONG_INTERNAL_URL',
        'https://kong-xyz.run.app',
        'prod',
      );
    });

    it('should handle secret sync failure gracefully', async () => {
      mockDeployKongCloudRun.mockResolvedValue({
        success: true,
        serviceUrl: 'https://kong-xyz.run.app',
      });
      mockSetSecretViaCli.mockImplementation(() => {
        throw new Error('Failed to set secret');
      });

      // Should not throw
      await infraKongDeploy({});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save'),
      );
    });
  });

  describe('logging', () => {
    it('should log success message on completion', async () => {
      await infraKongDeploy({});

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('deployed successfully'),
      );
    });

    it('should log deployment info', async () => {
      await infraKongDeploy({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Environment: prod'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Image:'),
      );
    });
  });

  describe('Azure provider routing', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);
    });

    it('should call azureKongDeploy for Azure provider', async () => {
      await infraKongDeploy({});

      expect(mockAzureKongDeploy).toHaveBeenCalledWith({
        projectRoot: '/test/project',
        targetEnv: 'prod',
        projectName: 'my-app',
        credentials: azureCredentials,
        imageTag: 'abc123',
      });
      expect(mockDeployKongCloudRun).not.toHaveBeenCalled();
    });

    it('should use custom tag when provided', async () => {
      await infraKongDeploy({ tag: 'v2.0.0' });

      expect(mockAzureKongDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          imageTag: 'v2.0.0',
        }),
      );
    });
  });
});
