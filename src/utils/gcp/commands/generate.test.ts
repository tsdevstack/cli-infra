import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const mockEnsureDirectory = rs.fn();
const mockWriteTextFile = rs.fn();
const mockIsFile = rs.fn((_path: string) => false);
const mockDeleteFile = rs.fn();
const mockCleanupFolder = rs.fn();
const mockExistsSync = rs.fn((_path: string) => false);

rs.mock('node:fs', () => ({
  existsSync: (path: string) => mockExistsSync(path),
}));

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    ensureDirectory: mockEnsureDirectory,
    writeTextFile: mockWriteTextFile,
    isFile: mockIsFile,
    deleteFile: mockDeleteFile,
    cleanupFolder: mockCleanupFolder,
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

rs.mock('@tsdevstack/infra-core', () => ({
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

const mockLoadInfrastructureConfig = rs.fn(
  (): Record<string, unknown> | null => null,
);

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));

const mockGetFrontendServicesWithDomains = rs.fn(
  (
    _overrides: unknown,
    _services: unknown,
  ): Array<{ name: string; domain: string; type: string }> => [],
);

rs.mock('../../infrastructure/get-frontend-services-with-domains', () => ({
  getFrontendServicesWithDomains: (overrides: unknown, services: unknown) =>
    mockGetFrontendServicesWithDomains(overrides, services),
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

import { gcpGenerate } from './generate';
import type { GCPCommandContext } from './types';

describe('gcpGenerate', () => {
  const mockContext: GCPCommandContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
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
    mockEnsureDirectory.mockClear();
    mockWriteTextFile.mockClear();
    mockIsFile.mockClear();
    mockDeleteFile.mockClear();
    mockCleanupFolder.mockClear();
    mockExistsSync.mockReturnValue(false);
    mockLoadInfrastructureConfig.mockReturnValue(null);
    mockGetFrontendServicesWithDomains.mockReturnValue([]);
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      cloud: { provider: 'gcp' },
      services: [
        { name: 'auth-service', hasDatabase: true },
        { name: 'api-service', hasDatabase: false },
      ],
    });
  });

  describe('directory creation', () => {
    it('should create output directory', async () => {
      await gcpGenerate(mockContext);

      expect(mockEnsureDirectory).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev',
      );
    });
  });

  describe('file generation', () => {
    it('should generate all terraform files', async () => {
      await gcpGenerate(mockContext);

      // 10 files: main, variables, network, database, redis, iam, artifact-registry, spa-buckets, outputs, tfvars
      expect(mockWriteTextFile).toHaveBeenCalledTimes(10);
    });

    it('should write main.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/main.tf',
        '# main.tf',
      );
    });

    it('should write variables.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/variables.tf',
        '# variables.tf',
      );
    });

    it('should write network.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/network.tf',
        '# network.tf',
      );
    });

    it('should write database.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/database.tf',
        '# database.tf',
      );
    });

    it('should write redis.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/redis.tf',
        '# redis.tf',
      );
    });

    it('should write artifact-registry.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/artifact-registry.tf',
        '# artifact-registry.tf',
      );
    });

    it('should write outputs.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/outputs.tf',
        '# outputs.tf',
      );
    });

    it('should write terraform.tfvars', async () => {
      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/terraform.tfvars',
        '# terraform.tfvars',
      );
    });
  });

  describe('cleanup', () => {
    it('should preserve cloud-scheduler.tf during cleanup but not loadbalancer.tf', async () => {
      await gcpGenerate(mockContext);

      expect(mockCleanupFolder).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev',
        ['.terraform', '.terraform.lock.hcl', 'cloud-scheduler.tf'],
      );
    });
  });

  describe('loadbalancer.tf regeneration', () => {
    it('should not generate loadbalancer.tf on fresh project (file did not exist)', async () => {
      mockExistsSync.mockReturnValue(false);

      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).not.toHaveBeenCalledWith(
        expect.stringContaining('loadbalancer.tf'),
        expect.any(String),
      );
    });

    it('should regenerate loadbalancer.tf when it existed before cleanup', async () => {
      mockExistsSync.mockReturnValue(true);
      mockLoadInfrastructureConfig.mockReturnValue({
        version: '1.0.0',
        dev: {
          frontend: { domain: 'example.com' },
          loadBalancer: { redirectDomains: ['example.dev'] },
        },
      });
      mockGetFrontendServicesWithDomains.mockReturnValue([
        { name: 'frontend', domain: 'example.com', type: 'cloudrun' },
      ]);

      await gcpGenerate(mockContext);

      // 10 base files + 1 loadbalancer.tf = 11
      expect(mockWriteTextFile).toHaveBeenCalledTimes(11);
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/project/infrastructure/terraform/dev/loadbalancer.tf',
        '# loadbalancer.tf',
      );
    });

    it('should not generate loadbalancer.tf even on existing project if no frontend domains', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGetFrontendServicesWithDomains.mockReturnValue([]);

      await gcpGenerate(mockContext);

      expect(mockWriteTextFile).toHaveBeenCalledTimes(10);
      expect(mockWriteTextFile).not.toHaveBeenCalledWith(
        expect.stringContaining('loadbalancer.tf'),
        expect.any(String),
      );
    });
  });

  describe('logging', () => {
    it('should log project info', async () => {
      await gcpGenerate(mockContext);

      expect(mocks.logger.info).toHaveBeenCalledWith('Project: my-app');
      expect(mocks.logger.info).toHaveBeenCalledWith('Environment: dev');
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'GCP Project: gcp-project-123',
      );
    });

    it('should log success for each file', async () => {
      await gcpGenerate(mockContext);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('main.tf'),
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('variables.tf'),
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('network.tf'),
      );
    });

    it('should log completion message', async () => {
      await gcpGenerate(mockContext);

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('generated'),
      );
    });

    it('should log next steps', async () => {
      await gcpGenerate(mockContext);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('infra:plan'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('infra:deploy'),
      );
    });
  });
});
