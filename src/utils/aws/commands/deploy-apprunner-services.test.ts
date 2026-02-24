import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../../commands/infra-docker-generate', () => ({
  infraDockerGenerate: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-build', () => ({
  infraDockerBuild: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-push', () => ({
  infraDockerPush: rs.fn(),
}));

rs.mock('../../docker', () => ({
  checkDockerInstalled: rs.fn(),
  getGitSha: rs.fn(() => 'abc123'),
}));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
  getTerraformOutputJson: rs.fn(),
}));

rs.mock('../apprunner', () => ({
  buildAppRunnerSecretsMap: rs.fn(),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('../../infrastructure/get-service-config', () => ({
  getServiceConfig: rs.fn(),
}));

const mockConfigureEcrAuth = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildFrontendEnvVars: rs.fn(() => ({})),
  configureEcrAuth: (...args: unknown[]) => mockConfigureEcrAuth(...args),
  parseServiceFilter: rs.fn((service?: string) =>
    service ? service.split(',') : undefined,
  ),
  buildAwsTerraformEnv: rs.fn(),
  createOrUpdateAppRunnerService: rs.fn(),
  waitForAppRunnerRunning: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('../../deploy/get-service-secret-keys', () => ({
  getServiceSecretKeys: rs.fn(),
}));

rs.mock('./parse-cpu-to-number', () => ({
  parseCpuToNumber: rs.fn((v: string) => parseInt(v) || 256),
}));

rs.mock('./parse-memory-to-number', () => ({
  parseMemoryToNumber: rs.fn((v: string) => parseInt(v) || 512),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(() => true),
  },
}));

rs.mock('p-map', () => ({
  default: rs.fn(
    async (items: unknown[], fn: (item: unknown) => Promise<unknown>) => {
      for (const item of items) {
        await fn(item);
      }
    },
  ),
}));

import fs from 'node:fs';
import { deployAppRunnerServices } from './deploy-apprunner-services';
import { getTerraformOutput, getTerraformOutputJson } from '../terraform';
import { buildAppRunnerSecretsMap } from '../apprunner';
import {
  buildAwsTerraformEnv,
  createOrUpdateAppRunnerService,
  waitForAppRunnerRunning,
} from '@tsdevstack/infra-core';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { getServiceSecretKeys } from '../../deploy/get-service-secret-keys';

describe('deployAppRunnerServices', () => {
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
        { name: 'frontend', type: 'nextjs' },
        { name: 'auth-service', type: 'nestjs' },
      ],
    });

    mockConfigureEcrAuth.mockResolvedValue(undefined);
    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          ecr_repository_url:
            '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app',
          apprunner_ecr_access_role_arn:
            'arn:aws:iam::123456789012:role/access',
          apprunner_instance_role_arn:
            'arn:aws:iam::123456789012:role/instance',
          api_url: 'https://api.dev.example.com',
        };
        return outputs[key] ?? '';
      },
    );
    rs.mocked(getTerraformOutputJson).mockReturnValue({
      frontend: 'arn:aws:apprunner:us-east-1:123:autoscaling/frontend',
    });

    rs.mocked(infraDockerGenerate).mockResolvedValue(undefined);
    rs.mocked(infraDockerBuild).mockResolvedValue(undefined);
    rs.mocked(infraDockerPush).mockResolvedValue(undefined);

    rs.mocked(getServiceSecretKeys).mockReturnValue([]);

    rs.mocked(buildAppRunnerSecretsMap).mockResolvedValue({
      success: true,
      secrets: {},
    });

    rs.mocked(createOrUpdateAppRunnerService).mockResolvedValue({
      serviceArn: 'arn:aws:apprunner:us-east-1:123:service/frontend',
      created: true,
    });

    rs.mocked(waitForAppRunnerRunning).mockResolvedValue({
      status: 'RUNNING',
      serviceUrl: 'https://abc.us-east-1.awsapprunner.com',
    });
  });

  it('should deploy only nextjs services', async () => {
    await deployAppRunnerServices(mockCtx, {});

    expect(infraDockerGenerate).toHaveBeenCalledTimes(1);
    expect(infraDockerGenerate).toHaveBeenCalledWith({ service: 'frontend' });
  });

  it('should skip when no nextjs services', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service', type: 'nestjs' }],
    });

    await deployAppRunnerServices(mockCtx, {});

    expect(createOrUpdateAppRunnerService).not.toHaveBeenCalled();
  });

  it('should throw when specific service not found', async () => {
    await expect(
      deployAppRunnerServices(mockCtx, { service: 'nonexistent' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform directory missing', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(deployAppRunnerServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(deployAppRunnerServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should skip Dockerfile generation when skipGenerate', async () => {
    await deployAppRunnerServices(mockCtx, { skipGenerate: true });

    expect(infraDockerGenerate).not.toHaveBeenCalled();
  });

  it('should authenticate Docker once and pass skipAuth to build and push', async () => {
    await deployAppRunnerServices(mockCtx, {});

    expect(mockConfigureEcrAuth).toHaveBeenCalledTimes(1);
    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('should create App Runner service', async () => {
    await deployAppRunnerServices(mockCtx, {});

    expect(createOrUpdateAppRunnerService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serviceName: 'my-app-dev-frontend',
        port: 8080,
      }),
    );
  });

  it('should throw when deployment fails', async () => {
    rs.mocked(createOrUpdateAppRunnerService).mockRejectedValue(
      new Error('Image not found'),
    );

    await expect(deployAppRunnerServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should wait for services to reach RUNNING status', async () => {
    await deployAppRunnerServices(mockCtx, {});

    expect(waitForAppRunnerRunning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serviceArn: 'arn:aws:apprunner:us-east-1:123:service/frontend',
        timeoutMs: 600000,
      }),
    );
  });

  it('should skip waiting when skipWait is true', async () => {
    await deployAppRunnerServices(mockCtx, { skipWait: true });

    expect(waitForAppRunnerRunning).not.toHaveBeenCalled();
  });

  it('should discover secrets for App Runner', async () => {
    await deployAppRunnerServices(mockCtx, {});

    expect(buildAppRunnerSecretsMap).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'my-app',
        serviceName: 'frontend',
      }),
    );
  });

  it('should remove duplicate keys between env vars and secrets', async () => {
    rs.mocked(getServiceSecretKeys).mockReturnValue(['API_URL']);
    rs.mocked(buildAppRunnerSecretsMap).mockResolvedValue({
      success: true,
      secrets: {
        API_URL: 'arn:aws:secretsmanager:us-east-1:123:secret:API_URL',
      },
    });

    await deployAppRunnerServices(mockCtx, {});

    // The API_URL from envVars should be removed since it's in secrets
    expect(createOrUpdateAppRunnerService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        environmentSecrets: expect.objectContaining({
          API_URL: expect.any(String),
        }),
      }),
    );
  });

  it('should log completion', async () => {
    await deployAppRunnerServices(mockCtx, {});

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      expect.stringContaining('deployed successfully'),
    );
  });
});
