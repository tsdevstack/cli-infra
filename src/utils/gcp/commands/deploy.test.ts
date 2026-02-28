import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockFs = {
  mkdirSync: rs.fn(),
  writeFileSync: rs.fn(),
  existsSync: rs.fn((_path: string) => false),
  unlinkSync: rs.fn((_path: string) => {}),
  readdirSync: rs.fn((_path: string) => [] as string[]),
};
rs.mock('node:fs', () => ({
  existsSync: (path: string) => mockFs.existsSync(path),
  default: {
    mkdirSync: (...args: unknown[]) => mockFs.mkdirSync(...args),
    writeFileSync: (...args: unknown[]) => mockFs.writeFileSync(...args),
    existsSync: (path: string) => mockFs.existsSync(path),
    unlinkSync: (path: string) => mockFs.unlinkSync(path),
    readdirSync: (path: string) => mockFs.readdirSync(path),
  },
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

const mockCheckTerraformInstalled = rs.fn();
const mockBuildGcpTerraformEnv = rs.fn(
  (_runtime: unknown, credentials: unknown) => {
    const creds = credentials as { project_id: string; region: string };
    return {
      GOOGLE_PROJECT: creds.project_id,
      GOOGLE_REGION: creds.region,
      GOOGLE_CREDENTIALS: JSON.stringify(creds),
    };
  },
);
rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: (...args: unknown[]) =>
    mockCheckTerraformInstalled(...args),
  buildGcpTerraformEnv: (runtime: unknown, credentials: unknown) =>
    mockBuildGcpTerraformEnv(runtime, credentials),
  gcp: {
    generateMainTf: rs.fn(() => '# main.tf'),
    generateVariablesTf: rs.fn(() => '# variables.tf'),
    generateNetworkTf: rs.fn(() => '# network.tf'),
    generateDatabaseTf: rs.fn(() => '# database.tf'),
    generateRedisTf: rs.fn(() => '# redis.tf'),
    generateIamTf: rs.fn(() => '# iam.tf'),
    generateArtifactRegistryTf: rs.fn(() => '# artifact-registry.tf'),
    generateSpaBucketsTf: rs.fn(() => '# spa-buckets.tf'),
    generateOutputsTf: rs.fn(() => '# outputs.tf'),
    generateTfvars: rs.fn(() => '# terraform.tfvars'),
    generateCloudSchedulerTf: rs.fn(() => '# cloud-scheduler.tf'),
    generateLoadBalancerTf: rs.fn(() => '# loadbalancer.tf'),
  },
}));

rs.mock('../../infrastructure/get-frontend-services-with-domains', () => ({
  getFrontendServicesWithDomains: rs.fn(() => []),
}));

const mockExecuteTerraform = rs.fn();
const mockGetTerraformOutput = rs.fn();
const mockToTfVarSuffix = rs.fn((name: string) =>
  name.replace(/-service$/, '').replace(/-/g, '_'),
);
rs.mock('../terraform', () => ({
  executeTerraform: (...args: unknown[]) => mockExecuteTerraform(...args),
  getTerraformOutput: (...args: unknown[]) => mockGetTerraformOutput(...args),
  toTfVarSuffix: (name: string) => mockToTfVarSuffix(name),
}));

const mockCreateBucket = rs.fn();
rs.mock('../create-bucket', () => ({
  createBucket: (...args: unknown[]) => mockCreateBucket(...args),
}));

rs.mock('../terraform-generate', () => ({
  generateMainTf: rs.fn(() => '# main.tf'),
  generateVariablesTf: rs.fn(() => '# variables.tf'),
  generateNetworkTf: rs.fn(() => '# network.tf'),
  generateDatabaseTf: rs.fn(() => '# database.tf'),
  generateRedisTf: rs.fn(() => '# redis.tf'),
  generateIamTf: rs.fn(() => '# iam.tf'),
  generateArtifactRegistryTf: rs.fn(() => '# artifact-registry.tf'),
  generateSpaBucketsTf: rs.fn(() => '# spa-buckets.tf'),
  generateOutputsTf: rs.fn(() => '# outputs.tf'),
  generateTfvars: rs.fn(() => '# terraform.tfvars'),
  generateCloudSchedulerTf: rs.fn(() => '# cloud-scheduler.tf'),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getDatabaseConfig: rs.fn(() => ({
    tier: 'db-f1-micro',
    diskSize: 10,
    deletionProtection: true,
    ha: false,
    backup: false,
  })),
  getRedisConfig: rs.fn(() => ({ tier: 'BASIC', memoryGb: 1 })),
  getScheduledJobs: rs.fn(() => []),
}));

const mockInquirer = {
  prompt: rs.fn(),
};
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirer.prompt(...args),
  },
}));

const mockFetchDbPasswordsFromSecretManager = rs.fn();
const mockSetSecretViaCli = rs.fn();
rs.mock('../../credentials/fetch-db-passwords-from-secret-manager', () => ({
  fetchDbPasswordsFromSecretManager: (...args: unknown[]) =>
    mockFetchDbPasswordsFromSecretManager(...args),
}));
rs.mock('../../credentials/set-secret-via-cli', () => ({
  setSecretViaCli: (...args: unknown[]) => mockSetSecretViaCli(...args),
}));

const mockInfraDeployServices = rs.fn();
rs.mock('../../../commands/infra-deploy-services', () => ({
  infraDeployServices: (...args: unknown[]) => mockInfraDeployServices(...args),
}));

const mockInfraKongGenerate = rs.fn();
rs.mock('../../../commands/infra-kong-generate', () => ({
  infraKongGenerate: (...args: unknown[]) => mockInfraKongGenerate(...args),
}));

const mockInfraKongBuild = rs.fn();
rs.mock('../../../commands/infra-kong-build', () => ({
  infraKongBuild: (...args: unknown[]) => mockInfraKongBuild(...args),
}));

const mockInfraKongDeploy = rs.fn();
rs.mock('../../../commands/infra-kong-deploy', () => ({
  infraKongDeploy: (...args: unknown[]) => mockInfraKongDeploy(...args),
}));

const mockInfraLbDeploy = rs.fn();
rs.mock('../../../commands/infra-lb-deploy', () => ({
  infraLbDeploy: (...args: unknown[]) => mockInfraLbDeploy(...args),
}));

import { gcpDeploy } from './deploy';
import type { GCPCommandContext } from './types';

describe('gcpDeploy', () => {
  const mockContext: GCPCommandContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'prod',
    credentials: {
      project_id: 'gcp-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'key',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    (mocks as Record<string, unknown>).cleanupFolder = rs.fn();
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      cloud: { provider: 'gcp' },
      services: [{ name: 'auth-service', hasDatabase: true }],
    });
    mockCreateBucket.mockResolvedValue({ success: true, isNew: false });
    mockExecuteTerraform.mockResolvedValue({ success: true });
    mockInquirer.prompt.mockResolvedValue({ confirm: true });
    // Mock password loading - always uses fetchDbPasswordsFromSecretManager
    mockFetchDbPasswordsFromSecretManager.mockResolvedValue({
      'auth-service': 'test-password',
    });
    // Mock getTerraformOutput for redis secrets
    mockGetTerraformOutput.mockImplementation((_dir: string, name: string) => {
      if (name === 'redis_host') return '10.0.0.5';
      if (name === 'redis_port') return '6379';
      if (name === 'redis_auth_string') return 'auto-generated-password';
      return '';
    });
    // Default mock for setSecretViaCli (no-op)
    mockSetSecretViaCli.mockImplementation(() => {});
  });

  describe('state bucket', () => {
    it('should ensure state bucket exists', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mockCreateBucket).toHaveBeenCalledWith(
        expect.objectContaining({
          bucketName: 'my-app-tf-state-gcp-project-123',
        }),
      );
    });

    it('should throw when bucket creation fails', async () => {
      mockCreateBucket.mockResolvedValue({
        success: false,
        error: 'Access denied',
      });

      await expect(
        gcpDeploy(mockContext, { autoApprove: true }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('terraform execution', () => {
    it('should run init, plan, and apply', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

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

    it('should apply with autoApprove flag', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'apply',
        expect.objectContaining({ autoApprove: true }),
      );
    });

    it('should throw when init fails', async () => {
      mockExecuteTerraform.mockResolvedValueOnce({
        success: false,
        error: 'Init failed',
      });

      await expect(
        gcpDeploy(mockContext, { autoApprove: true }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when plan fails', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Plan failed' });

      await expect(
        gcpDeploy(mockContext, { autoApprove: true }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when apply fails', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Apply failed' });

      await expect(
        gcpDeploy(mockContext, { autoApprove: true }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('confirmation prompt', () => {
    it('should prompt for confirmation when not autoApprove', async () => {
      await gcpDeploy(mockContext, {});

      expect(mockInquirer.prompt).toHaveBeenCalled();
    });

    it('should skip prompt when autoApprove is true', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mockInquirer.prompt).not.toHaveBeenCalled();
    });

    it('should skip prompt in CI environment', async () => {
      const ciContext = { ...mockContext, runningInCI: true };

      await gcpDeploy(ciContext, {});

      expect(mockInquirer.prompt).not.toHaveBeenCalled();
    });

    it('should cancel deployment when user declines', async () => {
      mockInquirer.prompt.mockResolvedValue({ confirm: false });

      await gcpDeploy(mockContext, {});

      expect(mockExecuteTerraform).not.toHaveBeenCalledWith(
        'apply',
        expect.any(Object),
      );
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cancelled'),
      );
    });
  });

  describe('logging', () => {
    it('should log success on completion', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('deployed successfully'),
      );
    });
  });

  describe('infraOnly flag', () => {
    it('should skip service deployment when infraOnly is true', async () => {
      await gcpDeploy(mockContext, { autoApprove: true, infraOnly: true });

      // Infrastructure phases should run
      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'apply',
        expect.any(Object),
      );

      // Service deployment phases should be skipped
      expect(mockInfraDeployServices).not.toHaveBeenCalled();
      expect(mockInfraKongGenerate).not.toHaveBeenCalled();
      expect(mockInfraKongBuild).not.toHaveBeenCalled();
      expect(mockInfraKongDeploy).not.toHaveBeenCalled();
    });

    it('should log skip message when infraOnly is true', async () => {
      await gcpDeploy(mockContext, { autoApprove: true, infraOnly: true });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipped: Service deployment'),
      );
    });
  });

  describe('full deployment phases', () => {
    it('should run all phases when infraOnly is false', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mockInfraDeployServices).toHaveBeenCalledWith({
        env: 'prod',
        tag: undefined,
      });
      expect(mockInfraKongGenerate).toHaveBeenCalledWith({ env: 'prod' });
      expect(mockInfraKongBuild).toHaveBeenCalledWith({
        env: 'prod',
        tag: undefined,
      });
      expect(mockInfraKongDeploy).toHaveBeenCalledWith({
        env: 'prod',
        tag: undefined,
      });
    });

    it('should pass tag option to deployment phases', async () => {
      await gcpDeploy(mockContext, { autoApprove: true, tag: 'v1.2.3' });

      expect(mockInfraDeployServices).toHaveBeenCalledWith({
        env: 'prod',
        tag: 'v1.2.3',
      });
      expect(mockInfraKongBuild).toHaveBeenCalledWith({
        env: 'prod',
        tag: 'v1.2.3',
      });
      expect(mockInfraKongDeploy).toHaveBeenCalledWith({
        env: 'prod',
        tag: 'v1.2.3',
      });
    });
  });

  describe('database URL sync', () => {
    it('should sync DATABASE_URL for services with database', async () => {
      mockGetTerraformOutput.mockImplementation(
        (_dir: string, name: string) => {
          if (name === 'database_private_ip') return '10.0.1.5';
          if (name === 'redis_host') return '10.0.0.5';
          if (name === 'redis_port') return '6379';
          if (name === 'redis_auth_string') return 'redis-password';
          return '';
        },
      );

      await gcpDeploy(mockContext, { autoApprove: true });

      // Should call setSecretViaCli with DATABASE_URL for auth-service
      expect(mockSetSecretViaCli).toHaveBeenCalledWith(
        'DATABASE_URL',
        expect.stringContaining('postgresql://auth-service:'),
        'prod',
        'auth-service',
      );
    });

    it('should skip DATABASE_URL for services without password', async () => {
      mockFetchDbPasswordsFromSecretManager.mockResolvedValue({});
      mockGetTerraformOutput.mockImplementation(
        (_dir: string, name: string) => {
          if (name === 'database_private_ip') return '10.0.1.5';
          if (name === 'redis_host') return '10.0.0.5';
          if (name === 'redis_port') return '6379';
          if (name === 'redis_auth_string') return 'redis-password';
          return '';
        },
      );

      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No password for auth-service'),
      );
    });
  });

  describe('redis secrets sync (post-apply)', () => {
    it('should sync Redis secrets to Secret Manager after apply', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

      // Should get terraform outputs
      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        expect.any(String),
        'redis_host',
        expect.any(Object),
      );
      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        expect.any(String),
        'redis_port',
        expect.any(Object),
      );
      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        expect.any(String),
        'redis_auth_string',
        expect.any(Object),
      );

      // Should set secrets via setSecretViaCli
      expect(mockSetSecretViaCli).toHaveBeenCalledWith(
        'REDIS_HOST',
        '10.0.0.5',
        'prod',
      );
      expect(mockSetSecretViaCli).toHaveBeenCalledWith(
        'REDIS_PORT',
        '6379',
        'prod',
      );
      expect(mockSetSecretViaCli).toHaveBeenCalledWith(
        'REDIS_PASSWORD',
        'auto-generated-password',
        'prod',
      );
    });

    it('should handle getTerraformOutput failure gracefully', async () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Command failed');
      });

      // Should not throw - just warn
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync Redis secrets'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('cloud-secrets:set REDIS_HOST'),
      );
    });

    it('should handle setSecretViaCli failure gracefully', async () => {
      mockSetSecretViaCli.mockImplementation(() => {
        throw new Error('Failed to set secret');
      });

      // Should not throw - just warn
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync Redis secrets'),
      );
    });

    it('should log success for each synced secret', async () => {
      await gcpDeploy(mockContext, { autoApprove: true });

      expect(mocks.logger.success).toHaveBeenCalledWith('  REDIS_HOST');
      expect(mocks.logger.success).toHaveBeenCalledWith('  REDIS_PORT');
      expect(mocks.logger.success).toHaveBeenCalledWith('  REDIS_PASSWORD');
    });
  });
});
