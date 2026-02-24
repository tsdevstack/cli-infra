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
  executeTerraform: rs.fn(),
  getTerraformOutput: rs.fn(),
}));

rs.mock('../bootstrap/create-state-backend', () => ({
  createStateBackend: rs.fn(),
}));

rs.mock('../../credentials/set-secret-via-cli', () => ({
  setSecretViaCli: rs.fn(),
}));

rs.mock('./generate-terraform-files', () => ({
  generateTerraformFiles: rs.fn(),
}));

rs.mock('./deploy-ecs-services', () => ({
  deployEcsServices: rs.fn(),
}));

rs.mock('./deploy-apprunner-services', () => ({
  deployAppRunnerServices: rs.fn(),
}));

rs.mock('./kong-deploy', () => ({
  awsKongDeploy: rs.fn(),
}));

rs.mock('../../docker', () => ({
  getGitSha: rs.fn(() => 'abc123'),
}));

rs.mock('../../../commands/infra-kong-generate', () => ({
  infraKongGenerate: rs.fn(),
}));

rs.mock('../../../commands/infra-kong-build', () => ({
  infraKongBuild: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: rs.fn(),
  extractLockId: rs.fn(),
  buildAwsTerraformEnv: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('../detect-deployed-origins', () => ({
  detectDeployedOrigins: rs.fn(),
}));

rs.mock('../deploy/deploy-spa-aws', () => ({
  deploySpaAws: rs.fn(),
}));

rs.mock('./build-and-push-db-init', () => ({
  buildAndPushDbInit: rs.fn(),
}));

rs.mock('./build-and-push-db-delete', () => ({
  buildAndPushDbDelete: rs.fn(),
}));

rs.mock('./run-db-init', () => ({
  runDbInit: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

rs.mock('node:fs', () => ({
  default: {
    writeFileSync: rs.fn(),
    readFileSync: rs.fn(() => '{}'),
  },
}));

import inquirer from 'inquirer';
import { awsDeploy } from './deploy';
import { executeTerraform, getTerraformOutput } from '../terraform';
import { extractLockId, buildAwsTerraformEnv } from '@tsdevstack/infra-core';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import { deployEcsServices } from './deploy-ecs-services';
import { deployAppRunnerServices } from './deploy-apprunner-services';
import { awsKongDeploy } from './kong-deploy';
import { detectDeployedOrigins } from '../detect-deployed-origins';
import { buildAndPushDbInit } from './build-and-push-db-init';
import { buildAndPushDbDelete } from './build-and-push-db-delete';
import { runDbInit } from './run-db-init';

describe('awsDeploy', () => {
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
    runningInCI: true,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(createStateBackend).mockResolvedValue({
      success: true,
      bucketName: 'my-app-terraform-state-123456789012',
      tableName: 'my-app-terraform-locks',
      bucketCreated: false,
      tableCreated: false,
    });

    rs.mocked(generateTerraformFiles).mockReturnValue({
      outputDir: '/test/project/infrastructure/terraform/dev',
      generateConfig: {} as never,
      servicesWithDatabase: [
        { name: 'auth-service', hasDatabase: true },
        { name: 'frontend', hasDatabase: false },
      ],
    });

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
      ],
    });

    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          redis_host: 'redis.cluster.amazonaws.com',
          redis_port: '6379',
          redis_auth_token: 'auth-token-123',
          alb_internal_dns: 'internal-alb.us-east-1.elb.amazonaws.com',
          db_init_ecr_url:
            '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app/db-init',
          db_delete_ecr_url:
            '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app/db-delete',
          ecs_cluster_name: 'my-app-cluster',
          db_init_task_arn: 'arn:aws:ecs:us-east-1:123:task-def/db-init',
          private_subnet_ids: '["subnet-1", "subnet-2"]',
          ecs_security_group_id: 'sg-123',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(detectDeployedOrigins).mockResolvedValue({
      nextjsOrigins: {},
      nextjsServiceArns: {},
      spaBucketsReady: {},
    });

    rs.mocked(buildAndPushDbInit).mockResolvedValue(undefined);
    rs.mocked(buildAndPushDbDelete).mockResolvedValue(undefined);
    rs.mocked(runDbInit).mockResolvedValue(undefined);
    rs.mocked(deployEcsServices).mockResolvedValue(undefined);
    rs.mocked(deployAppRunnerServices).mockResolvedValue(undefined);
    rs.mocked(awsKongDeploy).mockResolvedValue(undefined);
  });

  it('should create state backend first', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(createStateBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'my-app',
        accountId: '123456789012',
      }),
    );
  });

  it('should throw when state backend fails', async () => {
    rs.mocked(createStateBackend).mockResolvedValue({
      success: false,
      error: 'Access denied',
      bucketName: '',
      tableName: '',
      bucketCreated: false,
      tableCreated: false,
    });

    await expect(awsDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should generate terraform files', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(generateTerraformFiles).toHaveBeenCalledWith(
      mockCtx,
      'infra:deploy',
    );
  });

  it('should run terraform init, plan, and apply', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(executeTerraform).toHaveBeenCalledWith('init', expect.anything());
    expect(executeTerraform).toHaveBeenCalledWith('plan', expect.anything());
    expect(executeTerraform).toHaveBeenCalledWith(
      'apply',
      expect.objectContaining({
        autoApprove: true,
      }),
    );
  });

  it('should throw when terraform init fails', async () => {
    rs.mocked(executeTerraform).mockResolvedValueOnce({
      success: false,
      output: '',
      error: 'init failed',
    });

    await expect(awsDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when terraform plan fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'plan failed',
      }); // plan

    await expect(awsDeploy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should prompt for confirmation when not auto-approved', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });

    await awsDeploy({ ...mockCtx, runningInCI: false }, {});

    expect(inquirer.prompt).toHaveBeenCalled();
  });

  it('should abort when user declines confirmation', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

    await awsDeploy({ ...mockCtx, runningInCI: false }, {});

    expect(executeTerraform).not.toHaveBeenCalledWith(
      'apply',
      expect.anything(),
    );
  });

  it('should build and push db-init and db-delete images', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(buildAndPushDbInit).toHaveBeenCalled();
    expect(buildAndPushDbDelete).toHaveBeenCalled();
  });

  it('should run db-init for services with databases', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(runDbInit).toHaveBeenCalled();
  });

  it('should deploy ECS and App Runner services', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(deployEcsServices).toHaveBeenCalled();
    expect(deployAppRunnerServices).toHaveBeenCalled();
  });

  it('should deploy Kong Gateway', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(awsKongDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/test/project',
        targetEnv: 'dev',
      }),
    );
  });

  it('should skip service deployment with infraOnly', async () => {
    await awsDeploy(mockCtx, { autoApprove: true, infraOnly: true });

    expect(deployEcsServices).not.toHaveBeenCalled();
    expect(deployAppRunnerServices).not.toHaveBeenCalled();
    expect(awsKongDeploy).not.toHaveBeenCalled();
  });

  it('should handle force-unlock when plan fails with lock', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' }) // init
      .mockResolvedValueOnce({
        success: false,
        output: 'Lock ID: abc-123',
        error: 'state locked',
      }) // plan fails
      .mockResolvedValueOnce({ success: true, output: '' }) // force-unlock
      .mockResolvedValueOnce({ success: true, output: '' }) // plan retry
      .mockResolvedValue({ success: true, output: '' }); // apply + more

    rs.mocked(extractLockId).mockReturnValue('abc-123');

    await awsDeploy(mockCtx, { autoApprove: true, forceUnlock: true });

    expect(executeTerraform).toHaveBeenCalledWith(
      'force-unlock',
      expect.objectContaining({ lockId: 'abc-123' }),
    );
  });

  it('should log completion on success', async () => {
    await awsDeploy(mockCtx, { autoApprove: true });

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'Infrastructure deployment complete!',
    );
  });
});
