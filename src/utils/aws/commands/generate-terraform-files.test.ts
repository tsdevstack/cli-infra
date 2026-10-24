import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

// Mock ALL terraform generators with simple stubs
rs.mock('@tsdevstack/infra-core', () => ({
  aws: {
    generateMainTf: rs.fn(() => '# main.tf'),
    generateKmsTf: rs.fn(() => '# kms.tf'),
    generateCloudtrailTf: rs.fn(() => '# cloudtrail.tf'),
    generateVariablesTf: rs.fn(() => '# variables.tf'),
    generateTfvars: rs.fn(() => '# tfvars'),
    generateOutputsTf: rs.fn(() => '# outputs.tf'),
    generateNetworkTf: rs.fn(() => '# network.tf'),
    generateVpcFlowLogsTf: rs.fn(() => '# vpc-flow-logs.tf'),
    generateIamTf: rs.fn(() => '# iam.tf'),
    generateEcrTf: rs.fn(() => '# ecr.tf'),
    generateDatabaseTf: rs.fn(() => '# database.tf'),
    generateRedisTf: rs.fn(() => '# redis.tf'),
    generateEcsTf: rs.fn(() => '# ecs.tf'),
    generateLoggingTf: rs.fn(() => '# logging.tf'),
    generateAlbTf: rs.fn(() => '# alb.tf'),
    generateWafTf: rs.fn(() => '# waf.tf'),
    generateCloudfrontTf: rs.fn(() => '# cloudfront.tf'),
    generateAcmTf: rs.fn(() => '# acm.tf'),
    generateRoute53Tf: rs.fn(() => '# route53.tf'),
    generateS3SpaTf: rs.fn(() => '# s3-spa.tf'),
    generateEventbridgeTf: rs.fn(() => '# eventbridge.tf'),
    generateJobInvokerLambdaCode: rs.fn(() => '// job-invoker'),
    generateNextjsCloudfrontTf: rs.fn(() => '# nextjs-cloudfront.tf'),
    generateResponseHeadersPolicyTf: rs.fn(() => '# response-headers.tf'),
    generateRedirectTf: rs.fn(() => '# redirect.tf'),
    generateDbInitTf: rs.fn(() => '# db-init.tf'),
    generateDbInit: rs.fn(() => ({
      dockerfile: 'FROM node',
      packageJson: '{}',
      indexJs: '// init',
    })),
    generateDbDeleteTf: rs.fn(() => '# db-delete.tf'),
    generateDbDelete: rs.fn(() => ({
      dockerfile: 'FROM node',
      packageJson: '{}',
      indexJs: '// delete',
    })),
  },
  calculatePoolSize: rs.fn(() => ({
    poolMax: 15,
    dbConnections: 112,
    totalUsable: 90,
    totalInstances: 6,
  })),
  getTotalWorkerMaxInstances: rs.fn(() => 3),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getServiceConfig: rs.fn(() => ({
    cpu: '256',
    memory: '512',
    minInstances: 1,
    maxInstances: 3,
  })),
  getKongConfig: rs.fn(() => ({
    cpu: '256',
    memory: '512',
    minInstances: 1,
    maxInstances: 3,
  })),
  getScheduledJobs: rs.fn(() => []),
  getDatabaseConfig: rs.fn(() => ({
    tier: 'db.t3.micro',
    diskSize: 20,
    deletionProtection: true,
    ha: false,
    backup: true,
  })),
  getRedisConfig: rs.fn(() => ({
    tier: 'cache.t3.micro',
    memoryGb: 1,
  })),
}));

rs.mock('./parse-cpu-to-number', () => ({
  parseCpuToNumber: rs.fn(() => 256),
}));

rs.mock('./parse-memory-to-number', () => ({
  parseMemoryToNumber: rs.fn(() => 512),
}));

rs.mock('./normalize-fargate-config', () => ({
  FARGATE_DEFAULT: { cpu: 256, memory: 512 },
}));

rs.mock('./convert-cron-to-eventbridge', () => ({
  convertCronToEventBridge: rs.fn((cron: string) => `cron(${cron})`),
}));

rs.mock('../../deploy/get-total-service-max-instances', () => ({
  getTotalServiceMaxInstances: rs.fn(() => 6),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(() => 'example.com'),
}));

import { generateTerraformFiles } from './generate-terraform-files';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import type { ResolvedServiceConfig } from '../../infrastructure/types';
import {
  getScheduledJobs,
  getServiceConfig,
  getKongConfig,
  getDatabaseConfig,
} from '../../infrastructure/merge-with-defaults';

describe('generateTerraformFiles', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'offers-service', type: 'nestjs', hasDatabase: false },
        { name: 'frontend', type: 'nextjs' },
        { name: 'landing', type: 'spa' },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      ],
    });

    (mocks as Record<string, unknown>).cleanupFolder = rs.fn();
    mocks.ensureDirectory.mockReturnValue(undefined);
    mocks.writeTextFile.mockReturnValue(undefined);

    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
    rs.mocked(getScheduledJobs).mockReturnValue([]);
  });

  it('should return output directory', () => {
    const result = generateTerraformFiles(mockCtx, 'infra:generate');

    expect(result.outputDir).toBe('/test/project/infrastructure/terraform/dev');
  });

  it('should ensure output directory exists', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    expect(mocks.ensureDirectory).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev',
    );
  });

  it('should write all core terraform files', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    // Check that writeTextFile was called for core files
    const writeCalls = mocks.writeTextFile.mock.calls.map((call: unknown[]) =>
      (call[0] as string).split('/').pop(),
    );
    expect(writeCalls).toContain('main.tf');
    expect(writeCalls).toContain('kms.tf');
    expect(writeCalls).toContain('variables.tf');
    expect(writeCalls).toContain('outputs.tf');
    expect(writeCalls).toContain('network.tf');
    expect(writeCalls).toContain('iam.tf');
    expect(writeCalls).toContain('ecr.tf');
    expect(writeCalls).toContain('database.tf');
    expect(writeCalls).toContain('redis.tf');
    expect(writeCalls).toContain('ecs.tf');
    expect(writeCalls).toContain('logging.tf');
    expect(writeCalls).toContain('alb.tf');
    expect(writeCalls).toContain('waf.tf');
    expect(writeCalls).toContain('cloudfront.tf');
  });

  it('should return services with database info', () => {
    const result = generateTerraformFiles(mockCtx, 'infra:generate');

    expect(result.servicesWithDatabase).toEqual([
      { name: 'auth-service', hasDatabase: true },
      { name: 'offers-service', hasDatabase: false },
      { name: 'frontend', hasDatabase: false },
      { name: 'landing', hasDatabase: false },
      { name: 'auth-worker', hasDatabase: false },
    ]);
  });

  it('should throw when worker references non-existent base service', () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-worker', type: 'worker', baseService: 'nonexistent' },
      ],
    });

    expect(() => generateTerraformFiles(mockCtx, 'infra:generate')).toThrow(
      mocks.CliError,
    );
  });

  it('should generate db-init and db-delete directories', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    const writeCalls = mocks.writeTextFile.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    expect(
      writeCalls.some((p: string) => p.includes('db-init/Dockerfile')),
    ).toBe(true);
    expect(
      writeCalls.some((p: string) => p.includes('db-delete/Dockerfile')),
    ).toBe(true);
  });

  it('should generate lambda code directories', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    const writeCalls = mocks.writeTextFile.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    expect(
      writeCalls.some((p: string) => p.includes('lambda/job-invoker/index.js')),
    ).toBe(true);
  });

  it('should not generate the wake-up Lambda or scale-down files', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    const writeCalls = mocks.writeTextFile.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    expect(writeCalls.some((p: string) => p.includes('wakeup'))).toBe(false);
    expect(writeCalls.some((p: string) => p.includes('scale-down'))).toBe(
      false,
    );
    const createdDirs = mocks.ensureDirectory.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    expect(createdDirs.some((p: string) => p.includes('wakeup'))).toBe(false);
  });

  describe('minInstances validation (no scale-to-zero on AWS)', () => {
    const resolvedWithMin = (minInstances: number): ResolvedServiceConfig => ({
      cpu: '256',
      memory: '512',
      minInstances,
      maxInstances: 3,
      timeout: '300s',
      port: 3000,
      concurrency: 80,
    });

    it('should throw a CliError when a service resolves to minInstances 0', () => {
      rs.mocked(getServiceConfig).mockImplementation((_config, name) =>
        resolvedWithMin(name === 'auth-service' ? 0 : 1),
      );

      expect(() => generateTerraformFiles(mockCtx, 'infra:generate')).toThrow(
        'minInstances: 0 is not supported on AWS (dev.auth-service)',
      );
      expect(mocks.writeTextFile).not.toHaveBeenCalled();
    });

    it('should throw a CliError when a Next.js service resolves to minInstances 0', () => {
      rs.mocked(getServiceConfig).mockImplementation((_config, name) =>
        resolvedWithMin(name === 'frontend' ? 0 : 1),
      );

      expect(() => generateTerraformFiles(mockCtx, 'infra:generate')).toThrow(
        'minInstances: 0 is not supported on AWS (dev.frontend)',
      );
    });

    it('should throw a CliError when Kong resolves to minInstances 0', () => {
      rs.mocked(getKongConfig).mockReturnValue({
        cpu: '256',
        memory: '512',
        minInstances: 0,
        maxInstances: 3,
        maxUploadSize: '10m',
      });

      expect(() => generateTerraformFiles(mockCtx, 'infra:generate')).toThrow(
        mocks.CliError,
      );
      expect(() => generateTerraformFiles(mockCtx, 'infra:generate')).toThrow(
        'minInstances: 0 is not supported on AWS (dev.kong)',
      );
    });

    it('should pass minInstances through unchanged when 1 or more', () => {
      rs.mocked(getServiceConfig).mockImplementation(() => resolvedWithMin(2));
      rs.mocked(getKongConfig).mockReturnValue({
        cpu: '256',
        memory: '512',
        minInstances: 1,
        maxInstances: 3,
        maxUploadSize: '10m',
      });

      const result = generateTerraformFiles(mockCtx, 'infra:generate');

      expect(result.generateConfig.services['auth-service'].minInstances).toBe(
        2,
      );
      expect(result.generateConfig.services['kong'].minInstances).toBe(1);
      expect(result.generateConfig.frontends['frontend'].minInstances).toBe(2);
      expect(result.generateConfig.workers['auth-worker'].minInstances).toBe(2);
    });
  });

  it('should log files in verbose mode', () => {
    generateTerraformFiles(mockCtx, 'infra:generate', { verbose: true });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('main.tf'),
    );
  });

  it('should not log files in non-verbose mode', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    // logger.success should not be called with file names
    const successCalls = mocks.logger.success.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(
      successCalls.some(
        (msg) => typeof msg === 'string' && msg.includes('main.tf'),
      ),
    ).toBe(false);
  });

  it('should handle scheduled jobs', () => {
    rs.mocked(getScheduledJobs).mockReturnValue([
      {
        name: 'cleanup',
        schedule: '0 0 * * *',
        targetService: 'auth-service',
        endpoint: '/auth/jobs/cleanup',
      },
    ]);

    const result = generateTerraformFiles(mockCtx, 'infra:generate');

    expect(result.generateConfig.scheduledJobs).toHaveProperty(
      'auth-service-cleanup',
    );
  });

  it('should generate redirect when configured', () => {
    rs.mocked(loadInfrastructureConfig).mockReturnValue({
      version: '1',
      dev: {
        loadBalancer: {
          redirectDomains: ['old.example.com'],
        },
      },
    } as ReturnType<typeof loadInfrastructureConfig>);

    generateTerraformFiles(mockCtx, 'infra:generate');

    const writeCalls = mocks.writeTextFile.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    expect(writeCalls.some((p: string) => p.includes('redirect.tf'))).toBe(
      true,
    );
  });

  it('should pass database.diskSize to Terraform as storageSizeGb', () => {
    rs.mocked(getDatabaseConfig).mockReturnValueOnce({
      tier: 'db.t3.small',
      diskSize: 50,
      deletionProtection: false,
      ha: false,
      backup: true,
    });

    const result = generateTerraformFiles(mockCtx, 'infra:generate');

    expect(getDatabaseConfig).toHaveBeenCalledWith(null, 'dev', 'aws');
    expect(result.generateConfig.database).toEqual({
      tier: 'db.t3.small',
      storageSizeGb: 50,
      deletionProtection: false,
      backup: true,
      ha: false,
    });
  });

  it('should pass database.ha to Terraform', () => {
    rs.mocked(getDatabaseConfig).mockReturnValueOnce({
      tier: 'db.t3.micro',
      diskSize: 20,
      deletionProtection: true,
      ha: true,
      backup: true,
    });

    const result = generateTerraformFiles(mockCtx, 'infra:generate');

    expect(result.generateConfig.database.ha).toBe(true);
  });

  it('should pass only the Redis tier (AWS sizes Redis by node type)', () => {
    const result = generateTerraformFiles(mockCtx, 'infra:generate');

    expect(result.generateConfig.redis).toEqual({ tier: 'cache.t3.micro' });
  });

  it('should reject redis.memoryGb on AWS', () => {
    rs.mocked(loadInfrastructureConfig).mockReturnValue({
      version: '1.0.0',
      dev: { redis: { memoryGb: 2 } },
    } as ReturnType<typeof loadInfrastructureConfig>);

    expect(() => generateTerraformFiles(mockCtx, 'infra:generate')).toThrow(
      '"redis.memoryGb" is not supported on AWS',
    );
  });

  it('should reject a disk size below the RDS minimum', () => {
    rs.mocked(getDatabaseConfig).mockReturnValueOnce({
      tier: 'db.t3.micro',
      diskSize: 10,
      deletionProtection: true,
      ha: false,
      backup: true,
    });

    expect(() => generateTerraformFiles(mockCtx, 'infra:generate')).toThrow(
      mocks.CliError,
    );
  });

  it('should clean up old generated files', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    expect(
      (mocks as unknown as Record<string, ReturnType<typeof rs.fn>>)
        .cleanupFolder,
    ).toHaveBeenCalledWith('/test/project/infrastructure/terraform/dev', [
      '.terraform',
      '.terraform.lock.hcl',
    ]);
  });
});
