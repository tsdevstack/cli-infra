import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: rs.fn(),
  deployEcsServiceWithSecrets: rs.fn(),
  waitForEcsStable: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

import { awsDeployWorker } from './deploy-worker';
import { getTerraformOutput } from '../terraform';
import {
  buildAwsTerraformEnv,
  deployEcsServiceWithSecrets,
  waitForEcsStable,
} from '@tsdevstack/infra-core';

describe('awsDeployWorker', () => {
  const mockParams = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    worker: {
      name: 'auth-worker',
      type: 'worker' as const,
      baseService: 'auth-service',
    },
    baseService: { name: 'auth-service', type: 'nestjs' as const },
    imageTag: 'abc123',
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          ecs_cluster_name: 'my-app-cluster',
          ecr_repository_url:
            '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(deployEcsServiceWithSecrets).mockResolvedValue({
      taskDefinitionArn:
        'arn:aws:ecs:us-east-1:123456789012:task-definition/my-app-auth-worker:2',
      deploymentId: 'deploy-123',
    });

    rs.mocked(waitForEcsStable).mockResolvedValue({
      runningCount: 1,
      desiredCount: 1,
    });
  });

  it("should register the base service's image for the worker", async () => {
    await awsDeployWorker(mockParams);

    expect(deployEcsServiceWithSecrets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectName: 'my-app',
        clusterName: 'my-app-cluster',
        serviceName: 'auth-worker',
        imageUri:
          '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app/auth-service:abc123',
      }),
    );
  });

  it('should inject no secrets into the worker', async () => {
    await awsDeployWorker(mockParams);

    const options = rs.mocked(deployEcsServiceWithSecrets).mock.calls[0][1];
    expect(options.hasDatabase).toBe(false);
    expect(options.additionalSecrets).toBeUndefined();
  });

  it('should wait for service to stabilize', async () => {
    await awsDeployWorker(mockParams);

    expect(waitForEcsStable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serviceName: 'auth-worker',
        timeoutMs: 300000,
      }),
    );
  });

  it('should throw when ECS update fails', async () => {
    rs.mocked(deployEcsServiceWithSecrets).mockRejectedValue(
      new Error('Service not found'),
    );

    await expect(awsDeployWorker(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when service fails to stabilize', async () => {
    rs.mocked(waitForEcsStable).mockRejectedValue(new Error('Timed out'));

    await expect(awsDeployWorker(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(awsDeployWorker(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should log success on completion', async () => {
    await awsDeployWorker(mockParams);

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      expect.stringContaining('auth-worker'),
    );
  });
});
