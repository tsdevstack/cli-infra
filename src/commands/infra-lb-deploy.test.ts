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

const mockSetupGCPInfraCommand = rs.fn();
rs.mock('../utils/gcp/setup/setup-gcp-infra-command', () => ({
  setupGCPInfraCommand: (...args: unknown[]) =>
    mockSetupGCPInfraCommand(...args),
}));

const mockFs = {
  existsSync: rs.fn(),
  writeFileSync: rs.fn(),
};
rs.mock('node:fs', () => ({
  default: {
    existsSync: (path: string) => mockFs.existsSync(path),
    writeFileSync: (...args: unknown[]) => mockFs.writeFileSync(...args),
  },
}));

const mockExecSync = rs.fn();
rs.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const mockInquirer = {
  prompt: rs.fn(),
};
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirer.prompt(...args),
  },
}));

rs.mock('../utils/build-runtime', () => ({
  buildRuntime: () => ({}),
}));

const mockBuildGcpTerraformEnv = rs.fn();
const mockGenerateLoadBalancerTf = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: (...args: unknown[]) =>
    mockBuildGcpTerraformEnv(...args),
  gcp: {
    generateLoadBalancerTf: (...args: unknown[]) =>
      mockGenerateLoadBalancerTf(...args),
  },
}));

const mockExecuteTerraform = rs.fn();
const mockGetTerraformOutput = rs.fn();
const mockToTfVarSuffix = rs.fn((name: string) => name.replace(/-/g, '_'));
rs.mock('../utils/gcp/terraform', () => ({
  executeTerraform: (...args: unknown[]) => mockExecuteTerraform(...args),
  getTerraformOutput: (...args: unknown[]) => mockGetTerraformOutput(...args),
  toTfVarSuffix: (name: string) => mockToTfVarSuffix(name),
}));

const mockFetchDbPasswordsFromSecretManager = rs.fn();
rs.mock('../utils/credentials/fetch-db-passwords-from-secret-manager', () => ({
  fetchDbPasswordsFromSecretManager: (...args: unknown[]) =>
    mockFetchDbPasswordsFromSecretManager(...args),
}));

rs.mock('../utils/infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

import { infraLbDeploy } from './infra-lb-deploy';

describe('infraLbDeploy', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: 'key',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'prod',
    credentials: mockCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupGCPInfraCommand.mockResolvedValue(mockGCPContext);
    mockFs.existsSync.mockReturnValue(true);
    mockExecSync.mockReturnValue('example.com');
    mockBuildGcpTerraformEnv.mockReturnValue({
      GOOGLE_PROJECT: 'gcp-project-123',
    });
    mockGenerateLoadBalancerTf.mockReturnValue('# loadbalancer.tf content');
    mockExecuteTerraform.mockResolvedValue({ success: true });
    mockInquirer.prompt.mockResolvedValue({ confirm: true });
    mockGetTerraformOutput.mockReturnValue('34.123.456.789');
    mockFetchDbPasswordsFromSecretManager.mockResolvedValue({});
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      cloud: { provider: 'gcp' },
      services: [{ name: 'auth-service', hasDatabase: true }],
    });
  });

  describe('provider guard', () => {
    it('should throw for AWS provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'aws' },
        services: [],
      });

      await expect(infraLbDeploy({})).rejects.toThrow(mocks.CliError);
    });

    it('should throw for Azure provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'azure' },
        services: [],
      });

      await expect(infraLbDeploy({})).rejects.toThrow(mocks.CliError);
    });

    it('should proceed for GCP provider', async () => {
      await infraLbDeploy({ autoApprove: true });

      expect(mockSetupGCPInfraCommand).toHaveBeenCalled();
    });
  });

  describe('DOMAIN secret', () => {
    it('should throw when DOMAIN secret is not found', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Secret not found');
      });

      await expect(infraLbDeploy({})).rejects.toThrow(mocks.CliError);
    });

    it('should throw when DOMAIN secret is empty', async () => {
      mockExecSync.mockReturnValue('');

      await expect(infraLbDeploy({})).rejects.toThrow(mocks.CliError);
    });

    it('should use DOMAIN to build API domain', async () => {
      mockExecSync.mockReturnValue('myapp.com');

      await infraLbDeploy({ autoApprove: true });

      expect(mockGenerateLoadBalancerTf).toHaveBeenCalledWith(
        expect.objectContaining({
          apiDomain: 'api.myapp.com',
        }),
      );
    });
  });

  describe('terraform directory', () => {
    it('should throw when terraform directory does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(infraLbDeploy({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('load balancer generation', () => {
    it('should generate loadbalancer.tf file', async () => {
      await infraLbDeploy({ autoApprove: true });

      expect(mockGenerateLoadBalancerTf).toHaveBeenCalled();
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('loadbalancer.tf'),
        expect.any(String),
      );
    });

    it('should pass frontend services with domains', async () => {
      const { loadInfrastructureConfig } =
        await import('../utils/infrastructure/load-infrastructure-config');
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1.0.0',
        prod: {
          frontend: { domain: 'app.example.com' },
        },
      } as ReturnType<typeof loadInfrastructureConfig>);
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'gcp' },
        services: [
          { name: 'auth-service', type: 'nestjs' },
          { name: 'frontend', type: 'nextjs' },
        ],
      });

      await infraLbDeploy({ autoApprove: true });

      expect(mockGenerateLoadBalancerTf).toHaveBeenCalledWith(
        expect.objectContaining({
          frontendServices: expect.arrayContaining([
            expect.objectContaining({
              name: 'frontend',
              domain: 'app.example.com',
            }),
          ]),
        }),
      );
    });
  });

  describe('terraform execution', () => {
    it('should run init, plan, and apply', async () => {
      await infraLbDeploy({ autoApprove: true });

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'init',
        expect.any(Object),
      );
      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'plan',
        expect.any(Object),
      );
      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'apply',
        expect.any(Object),
      );
    });

    it('should throw when init fails', async () => {
      mockExecuteTerraform.mockResolvedValueOnce({
        success: false,
        error: 'Init failed',
      });

      await expect(infraLbDeploy({ autoApprove: true })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when plan fails', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Plan failed' });

      await expect(infraLbDeploy({ autoApprove: true })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when apply fails', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Apply failed' });

      await expect(infraLbDeploy({ autoApprove: true })).rejects.toThrow(
        mocks.CliError,
      );
    });
  });

  describe('confirmation prompt', () => {
    it('should prompt for confirmation when not autoApprove', async () => {
      await infraLbDeploy({});

      expect(mockInquirer.prompt).toHaveBeenCalled();
    });

    it('should skip prompt when autoApprove is true', async () => {
      await infraLbDeploy({ autoApprove: true });

      expect(mockInquirer.prompt).not.toHaveBeenCalled();
    });

    it('should skip prompt in CI environment', async () => {
      mockSetupGCPInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        runningInCI: true,
      });

      await infraLbDeploy({});

      expect(mockInquirer.prompt).not.toHaveBeenCalled();
    });

    it('should cancel deployment when user declines', async () => {
      mockInquirer.prompt.mockResolvedValue({ confirm: false });

      await infraLbDeploy({});

      expect(mockExecuteTerraform).not.toHaveBeenCalledWith(
        'apply',
        expect.any(Object),
      );
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cancelled'),
      );
    });
  });

  describe('database passwords', () => {
    it('should load database passwords for services with database', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'gcp' },
        services: [
          { name: 'auth-service', hasDatabase: true },
          { name: 'frontend', hasDatabase: false },
        ],
      });
      mockFetchDbPasswordsFromSecretManager.mockResolvedValue({
        'auth-service': 'db-password-123',
      });

      await infraLbDeploy({ autoApprove: true });

      expect(mockFetchDbPasswordsFromSecretManager).toHaveBeenCalledWith(
        'prod',
        [{ name: 'auth-service', hasDatabase: true }],
      );
    });
  });

  describe('load balancer IP output', () => {
    it('should display load balancer IP on success', async () => {
      mockGetTerraformOutput.mockReturnValue('34.100.200.50');

      await infraLbDeploy({ autoApprove: true });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('34.100.200.50'),
      );
    });

    it('should handle terraform output failure gracefully', async () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Output not found');
      });

      // Should not throw
      await infraLbDeploy({ autoApprove: true });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not retrieve'),
      );
    });
  });

  describe('success logging', () => {
    it('should log success message', async () => {
      await infraLbDeploy({ autoApprove: true });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('deployed successfully'),
      );
    });
  });
});
