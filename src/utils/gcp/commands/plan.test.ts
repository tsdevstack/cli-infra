import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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
  unlinkSync: rs.fn((_path: string) => undefined),
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
const mockToTfVarSuffix = rs.fn((name: string) =>
  name.replace(/-service$/, '').replace(/-/g, '_'),
);
rs.mock('../terraform', () => ({
  executeTerraform: (...args: unknown[]) => mockExecuteTerraform(...args),
  toTfVarSuffix: (name: string) => mockToTfVarSuffix(name),
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

const mockFetchDbPasswordsFromSecretManager = rs.fn();
rs.mock('../../credentials/fetch-db-passwords-from-secret-manager', () => ({
  fetchDbPasswordsFromSecretManager: (...args: unknown[]) =>
    mockFetchDbPasswordsFromSecretManager(...args),
}));

const mockCreateBucket = rs.fn();
rs.mock('../create-bucket', () => ({
  createBucket: (...args: unknown[]) => mockCreateBucket(...args),
}));

rs.mock('../get-gcs-location-from-region', () => ({
  getGcsLocationFromRegion: rs.fn(() => 'US'),
}));

import { gcpPlan } from './plan';
import type { GCPCommandContext } from './types';

describe('gcpPlan', () => {
  const mockContext: GCPCommandContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'staging',
    credentials: {
      project_id: 'gcp-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'key',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    (mocks as Record<string, unknown>).cleanupFolder = rs.fn();
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      cloud: { provider: 'gcp' },
      services: [{ name: 'auth-service', hasDatabase: true }],
    });
    mockCreateBucket.mockResolvedValue({ success: true, isNew: false });
    mockExecuteTerraform.mockResolvedValue({ success: true });
    mockFetchDbPasswordsFromSecretManager.mockResolvedValue({
      'auth-service': 'test-password',
    });
  });

  describe('terraform check', () => {
    it('should check terraform is installed', async () => {
      await gcpPlan(mockContext);

      expect(mockCheckTerraformInstalled).toHaveBeenCalled();
    });
  });

  describe('terraform execution', () => {
    it('should run terraform init', async () => {
      await gcpPlan(mockContext);

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'init',
        expect.objectContaining({
          workDir: '/test/project/infrastructure/terraform/staging',
        }),
      );
    });

    it('should run terraform plan after init', async () => {
      await gcpPlan(mockContext);

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'plan',
        expect.objectContaining({
          workDir: '/test/project/infrastructure/terraform/staging',
        }),
      );
    });

    it('should pass GCP credentials as env vars', async () => {
      await gcpPlan(mockContext);

      expect(mockExecuteTerraform).toHaveBeenCalledWith(
        'init',
        expect.objectContaining({
          env: expect.objectContaining({
            GOOGLE_PROJECT: 'gcp-project-123',
            GOOGLE_REGION: 'us-central1',
          }),
        }),
      );
    });

    it('should throw when init fails', async () => {
      mockExecuteTerraform.mockResolvedValueOnce({
        success: false,
        error: 'Init failed',
      });

      await expect(gcpPlan(mockContext)).rejects.toThrow(mocks.CliError);
    });

    it('should throw when plan fails', async () => {
      mockExecuteTerraform
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Plan failed' });

      await expect(gcpPlan(mockContext)).rejects.toThrow(mocks.CliError);
    });
  });

  describe('logging', () => {
    it('should log project info', async () => {
      await gcpPlan(mockContext);

      expect(mocks.logger.info).toHaveBeenCalledWith('Project: my-app');
      expect(mocks.logger.info).toHaveBeenCalledWith('Environment: staging');
    });

    it('should log next steps after success', async () => {
      await gcpPlan(mockContext);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('infra:deploy'),
      );
    });
  });
});
