import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: rs.fn(),
  executeEcsTask: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getMigrationJobConfig: rs.fn(() => ({ cpu: '1024', memory: '2048' })),
}));

import { awsDbMigrateRun } from './db-migrate-run';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv, executeEcsTask } from '@tsdevstack/infra-core';

describe('awsDbMigrateRun', () => {
  const mockParams = {
    projectRoot: '/test/project',
    targetEnv: 'dev',
    projectName: 'my-app',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    service: {
      name: 'auth-service',
      type: 'nestjs' as const,
      hasDatabase: true,
    },
  };

  beforeEach(() => {
    rs.resetAllMocks();
    (mocks as Record<string, unknown>).buildSecretName = rs.fn(
      (project: string, scope: string, key: string) =>
        `${project}-${scope}-${key}`,
    );

    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          ecr_repository_url:
            '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app',
          ecs_cluster_name: 'my-app-cluster',
          private_subnet_ids: '["subnet-1", "subnet-2"]',
          ecs_security_group_id: 'sg-123',
          ecs_execution_role_arn: 'arn:aws:iam::123456789012:role/exec',
          ecs_task_role_arns:
            '{"auth-service": "arn:aws:iam::123456789012:role/task-auth"}',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(executeEcsTask).mockResolvedValue({
      success: true,
      logs: 'Applied 2 migrations',
    });
  });

  it('should execute ECS task with prisma migrate deploy command', async () => {
    await awsDbMigrateRun(mockParams);

    expect(executeEcsTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        command: [
          'node',
          './node_modules/prisma/build/index.js',
          'migrate',
          'deploy',
        ],
      }),
    );
  });

  it('should use custom image tag when provided', async () => {
    await awsDbMigrateRun({ ...mockParams, imageTag: 'abc123' });

    expect(executeEcsTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageUri: expect.stringContaining(':abc123'),
      }),
    );
  });

  it('should use latest tag by default', async () => {
    await awsDbMigrateRun(mockParams);

    expect(executeEcsTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageUri: expect.stringContaining(':latest'),
      }),
    );
  });

  it('should throw CliError on migration failure', async () => {
    rs.mocked(executeEcsTask).mockResolvedValue({
      success: false,
      logs: 'Migration error: relation already exists',
    });

    await expect(awsDbMigrateRun(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should log success on completion', async () => {
    await awsDbMigrateRun(mockParams);

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'Migrations applied successfully!',
    );
  });

  it('should throw when task role not found', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          ecr_repository_url: 'ecr-url',
          ecs_cluster_name: 'cluster',
          private_subnet_ids: '["subnet-1"]',
          ecs_security_group_id: 'sg-123',
          ecs_execution_role_arn: 'arn:exec',
          ecs_task_role_arns: '{}',
        };
        return outputs[key] ?? '';
      },
    );

    await expect(awsDbMigrateRun(mockParams)).rejects.toThrow(mocks.CliError);
  });
});
