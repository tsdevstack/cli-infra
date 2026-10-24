import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  DescribeTaskDefinitionCommand: rs.fn(),
  RegisterTaskDefinitionCommand: rs.fn(),
  UpdateServiceCommand: rs.fn(),
}));

rs.mock('../../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  AWS_KONG_CLIENT_IP_SETTINGS: {
    KONG_TRUSTED_IPS: '0.0.0.0/0,::/0',
    KONG_REAL_IP_HEADER: 'X-Tsdevstack-Edge-IP',
    KONG_REAL_IP_RECURSIVE: 'off',
  },
  buildAwsTerraformEnv: rs.fn(),
  waitForEcsStable: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

import { RegisterTaskDefinitionCommand } from '@aws-sdk/client-ecs';
import { awsKongDeploy } from './deploy-kong';
import { getTerraformOutput } from '../../terraform';
import { buildAwsTerraformEnv, waitForEcsStable } from '@tsdevstack/infra-core';

describe('awsKongDeploy', () => {
  const mockParams = {
    projectRoot: '/test/project',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    imageTag: 'abc123',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    (mocks as Record<string, unknown>).isCIEnv = rs.fn(() => false);

    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          ecs_cluster_name: 'my-app-cluster',
          ecr_repository_url:
            '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app',
          aws_account_id: '123456789012',
        };
        return outputs[key] ?? '';
      },
    );

    // Mock ECS SDK calls
    mockSend
      .mockResolvedValueOnce({
        // DescribeTaskDefinition
        taskDefinition: {
          family: 'my-app-kong',
          networkMode: 'awsvpc',
          requiresCompatibilities: ['FARGATE'],
          cpu: '256',
          memory: '512',
          executionRoleArn: 'arn:exec',
          taskRoleArn: 'arn:task',
          containerDefinitions: [
            {
              name: 'kong',
              image: 'old-image:old-tag',
              portMappings: [{ containerPort: 8000 }],
              environment: [{ name: 'KONG_DATABASE', value: 'off' }],
              logConfiguration: { logDriver: 'awslogs' },
              healthCheck: { command: ['CMD', 'kong', 'health'] },
              essential: true,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        // RegisterTaskDefinition
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:us-east-1:123:task-def/kong:2',
        },
      })
      .mockResolvedValueOnce({
        // UpdateService
        service: {
          deployments: [{ id: 'deploy-abc' }],
        },
      });

    rs.mocked(waitForEcsStable).mockResolvedValue({
      runningCount: 1,
      desiredCount: 1,
    });
  });

  it('should fetch existing task definition', async () => {
    await awsKongDeploy(mockParams);

    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('should register new task definition with secrets', async () => {
    await awsKongDeploy(mockParams);

    // Second send call is RegisterTaskDefinition
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('should keep the environment and set the client address settings on top', async () => {
    await awsKongDeploy(mockParams);

    const registered = rs.mocked(RegisterTaskDefinitionCommand).mock
      .calls[0][0] as {
      containerDefinitions: Array<{
        image: string;
        environment: Array<{ name: string; value: string }>;
      }>;
    };
    expect(registered.containerDefinitions[0].image).toContain('kong:');
    expect(registered.containerDefinitions[0].environment).toEqual([
      { name: 'KONG_DATABASE', value: 'off' },
      { name: 'KONG_TRUSTED_IPS', value: '0.0.0.0/0,::/0' },
      { name: 'KONG_REAL_IP_HEADER', value: 'X-Tsdevstack-Edge-IP' },
      { name: 'KONG_REAL_IP_RECURSIVE', value: 'off' },
    ]);
  });

  it('should update ECS service with new task definition', async () => {
    await awsKongDeploy(mockParams);

    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('should wait for service to stabilize', async () => {
    await awsKongDeploy(mockParams);

    expect(waitForEcsStable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serviceName: 'kong',
        clusterName: 'my-app-cluster',
      }),
    );
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(awsKongDeploy(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when task definition not found', async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValueOnce({ taskDefinition: null });

    await expect(awsKongDeploy(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when service fails to stabilize', async () => {
    rs.mocked(waitForEcsStable).mockRejectedValue(new Error('Timed out'));

    await expect(awsKongDeploy(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should log success on completion', async () => {
    await awsKongDeploy(mockParams);

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'Kong Gateway deployed successfully!',
    );
  });
});
