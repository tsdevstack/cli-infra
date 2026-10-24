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
}));

rs.mock('@tsdevstack/infra-core', () => ({
  AWS_NEXTJS_CLIENT_IP_SETTINGS: {
    TSDEVSTACK_CLIENT_IP_HEADER: 'X-Tsdevstack-Edge-IP',
  },
  buildAwsTerraformEnv: rs.fn(),
  configureEcrAuth: rs.fn(),
  deployEcsServiceWithSecrets: rs.fn(),
  waitForEcsStable: rs.fn(),
  parseServiceFilter: rs.fn((s?: string) => (s ? s.split(',') : undefined)),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('../../deploy/get-service-secret-keys', () => ({
  getServiceSecretKeys: rs.fn(() => ['API_URL', 'KONG_FRONTEND_TOKEN']),
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

import { deployNextjsServices } from './deploy-nextjs-services';
import { getTerraformOutput } from '../terraform';
import {
  buildAwsTerraformEnv,
  configureEcrAuth,
  deployEcsServiceWithSecrets,
  waitForEcsStable,
} from '@tsdevstack/infra-core';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerPush } from '../../../commands/infra-docker-push';

describe('deployNextjsServices', () => {
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
        { name: 'frontend', type: 'nextjs' },
      ],
    });

    rs.mocked(configureEcrAuth).mockResolvedValue(undefined);
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
    rs.mocked(deployEcsServiceWithSecrets).mockResolvedValue({
      taskDefinitionArn: 'arn:aws:ecs:us-east-1:123:task-def/frontend:2',
    });
    rs.mocked(waitForEcsStable).mockResolvedValue({
      runningCount: 1,
      desiredCount: 1,
    });
  });

  describe('Standard use cases', () => {
    it('should deploy only the Next.js services', async () => {
      await deployNextjsServices(mockCtx, {});

      expect(infraDockerBuild).toHaveBeenCalledTimes(1);
      expect(infraDockerBuild).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'frontend', tag: 'abc123' }),
      );
      expect(deployEcsServiceWithSecrets).toHaveBeenCalledTimes(1);
    });

    it('should give the service its secrets and the visitor header name', async () => {
      await deployNextjsServices(mockCtx, {});

      expect(deployEcsServiceWithSecrets).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          serviceName: 'frontend',
          hasDatabase: false,
          additionalSecrets: {
            API_URL:
              'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-app-shared-API_URL',
            KONG_FRONTEND_TOKEN:
              'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-app-shared-KONG_FRONTEND_TOKEN',
          },
          additionalEnvironment: {
            TSDEVSTACK_CLIENT_IP_HEADER: 'X-Tsdevstack-Edge-IP',
          },
        }),
      );
    });
  });

  describe('Edge cases', () => {
    it('should do nothing without Next.js services', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        services: [{ name: 'auth-service', type: 'nestjs' }],
      });

      await deployNextjsServices(mockCtx, {});

      expect(deployEcsServiceWithSecrets).not.toHaveBeenCalled();
    });

    it('should fail when the ECS update fails', async () => {
      rs.mocked(deployEcsServiceWithSecrets).mockRejectedValue(
        new Error('Task definition not found'),
      );

      await expect(deployNextjsServices(mockCtx, {})).rejects.toThrow(
        mocks.CliError,
      );
    });
  });
});
