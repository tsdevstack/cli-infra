import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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
}));

const mockConfigureEcrAuth = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: rs.fn(),
  configureEcrAuth: (...args: unknown[]) => mockConfigureEcrAuth(...args),
  deployEcsServiceWithSecrets: rs.fn(),
  waitForEcsStable: rs.fn(),
  parseServiceFilter: rs.fn((s?: string) => (s ? s.split(',') : undefined)),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('./deploy-worker', () => ({
  awsDeployWorker: rs.fn(),
}));

rs.mock('../../credentials/set-secret-via-cli', () => ({
  setSecretViaCli: rs.fn(),
}));

rs.mock('./db-migrate-run', () => ({
  awsDbMigrateRun: rs.fn(),
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
import { deployEcsServices } from './deploy-ecs-services';
import { getTerraformOutput } from '../terraform';
import {
  buildAwsTerraformEnv,
  deployEcsServiceWithSecrets,
  waitForEcsStable,
} from '@tsdevstack/infra-core';
import { awsDeployWorker } from './deploy-worker';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { awsDbMigrateRun } from './db-migrate-run';

describe('deployEcsServices', () => {
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
      ],
    });

    mockConfigureEcrAuth.mockResolvedValue(undefined);
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          ecr_repository_url:
            '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app',
          ecs_cluster_name: 'my-app-cluster',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(infraDockerGenerate).mockResolvedValue(undefined);
    rs.mocked(infraDockerBuild).mockResolvedValue(undefined);
    rs.mocked(infraDockerPush).mockResolvedValue(undefined);
    rs.mocked(awsDbMigrateRun).mockResolvedValue(undefined);

    rs.mocked(deployEcsServiceWithSecrets).mockResolvedValue({
      taskDefinitionArn: 'arn:aws:ecs:us-east-1:123:task-def/test:1',
    });
    rs.mocked(waitForEcsStable).mockResolvedValue({
      runningCount: 1,
      desiredCount: 1,
    });
  });

  it('should deploy only nestjs services', async () => {
    await deployEcsServices(mockCtx, {});

    expect(infraDockerGenerate).toHaveBeenCalledTimes(2); // auth + offers
    expect(infraDockerBuild).toHaveBeenCalledTimes(2);
    expect(infraDockerPush).toHaveBeenCalledTimes(2);
  });

  it('should filter by specific service', async () => {
    await deployEcsServices(mockCtx, { service: 'auth-service' });

    expect(infraDockerGenerate).toHaveBeenCalledTimes(1);
    expect(infraDockerGenerate).toHaveBeenCalledWith({
      service: 'auth-service',
    });
  });

  it('should throw when specific service not found', async () => {
    await expect(
      deployEcsServices(mockCtx, { service: 'nonexistent' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should skip when no nestjs services', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'frontend', type: 'nextjs' }],
    });

    await deployEcsServices(mockCtx, {});

    expect(deployEcsServiceWithSecrets).not.toHaveBeenCalled();
  });

  it('should throw when terraform directory missing', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(deployEcsServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(deployEcsServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should skip Dockerfile generation when skipGenerate is true', async () => {
    await deployEcsServices(mockCtx, { skipGenerate: true });

    expect(infraDockerGenerate).not.toHaveBeenCalled();
  });

  it('should authenticate Docker once and pass skipAuth to build and push', async () => {
    await deployEcsServices(mockCtx, {});

    expect(mockConfigureEcrAuth).toHaveBeenCalledTimes(1);
    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('should run migrations for services with databases', async () => {
    await deployEcsServices(mockCtx, {});

    expect(awsDbMigrateRun).toHaveBeenCalledTimes(1);
    expect(awsDbMigrateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        service: expect.objectContaining({ name: 'auth-service' }),
      }),
    );
  });

  it('should update ECS services with secrets', async () => {
    await deployEcsServices(mockCtx, {});

    expect(deployEcsServiceWithSecrets).toHaveBeenCalledTimes(2);
  });

  it('should throw when ECS service update fails', async () => {
    rs.mocked(deployEcsServiceWithSecrets).mockRejectedValue(
      new Error('Task definition not found'),
    );

    await expect(deployEcsServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should deploy coupled workers', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      ],
    });

    await deployEcsServices(mockCtx, {});

    expect(awsDeployWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: expect.objectContaining({ name: 'auth-worker' }),
        baseService: expect.objectContaining({ name: 'auth-service' }),
      }),
    );
  });

  it('should use custom image tag', async () => {
    await deployEcsServices(mockCtx, { tag: 'custom-tag' });

    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'custom-tag' }),
    );
  });

  it('should log completion', async () => {
    await deployEcsServices(mockCtx, {});

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      expect.stringContaining('deployed successfully'),
    );
  });
});
