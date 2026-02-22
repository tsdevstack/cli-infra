import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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

import { awsDbMigratePlan } from './db-migrate-plan';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv, executeEcsTask } from '@tsdevstack/infra-core';

describe('awsDbMigratePlan', () => {
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
      logs: 'Migration status: 2 applied',
    });
  });

  it('should execute ECS task with prisma migrate status command', async () => {
    await awsDbMigratePlan(mockParams);

    expect(executeEcsTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        command: [
          'node',
          './node_modules/prisma/build/index.js',
          'migrate',
          'status',
        ],
      }),
    );
  });

  it('should pass correct secret ARN', async () => {
    await awsDbMigratePlan(mockParams);

    expect(executeEcsTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        secretArn: expect.stringContaining('my-app-auth-service-DATABASE_URL'),
      }),
    );
  });

  it('should throw when task role not found for service', async () => {
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

    await expect(awsDbMigratePlan(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('terraform not initialized');
    });

    await expect(awsDbMigratePlan(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should log completion on success', async () => {
    await awsDbMigratePlan(mockParams);

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'Migration status check completed',
    );
  });

  it('should log error on task failure', async () => {
    rs.mocked(executeEcsTask).mockResolvedValue({
      success: false,
      logs: 'Connection refused',
    });

    await awsDbMigratePlan(mockParams);

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Migration status check failed',
    );
  });
});
