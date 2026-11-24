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
}));

rs.mock('@tsdevstack/infra-core', () => ({
  checkTerraformInstalled: rs.fn(),
  buildAwsTerraformEnv: rs.fn(),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('../disable-deletion-protection', () => ({
  disableDeletionProtection: rs.fn(),
}));

rs.mock('../disable-alb-deletion-protection', () => ({
  disableAlbDeletionProtection: rs.fn(),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(),
  },
}));

rs.mock('../delete', () => ({
  deleteCloudWatchLogGroup: rs.fn(),
  deleteEcsTaskDefinitionFamily: rs.fn(),
}));

rs.mock('../discovery/discover-aws-cron-jobs', () => ({
  discoverAwsCronJobs: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

import fs from 'node:fs';
import inquirer from 'inquirer';
import { awsDestroy } from './destroy';
import { executeTerraform } from '../terraform';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';
import { disableDeletionProtection } from '../disable-deletion-protection';
import { disableAlbDeletionProtection } from '../disable-alb-deletion-protection';
import {
  deleteCloudWatchLogGroup,
  deleteEcsTaskDefinitionFamily,
} from '../delete';
import { discoverAwsCronJobs } from '../discovery/discover-aws-cron-jobs';

describe('awsDestroy', () => {
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
    rs.mocked(deleteCloudWatchLogGroup).mockResolvedValue({
      success: true,
      deleted: false,
    });
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(buildAwsTerraformEnv).mockReturnValue({
      AWS_REGION: 'us-east-1',
    });
    rs.mocked(executeTerraform).mockResolvedValue({
      success: true,
      output: '',
    });
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
    rs.mocked(disableAlbDeletionProtection).mockResolvedValue({
      success: true,
    });
    rs.mocked(discoverAwsCronJobs).mockResolvedValue([]);
    rs.mocked(deleteEcsTaskDefinitionFamily).mockResolvedValue({
      success: true,
      deleted: true,
    });
  });

  describe("Cron jobs' task definitions", () => {
    const usageReport = {
      name: 'usage-report',
      serviceName: 'auth-service',
      taskFamily: 'my-app-cron-usage-report',
      containerName: 'cron-usage-report',
      logGroupName: '/ecs/my-app/cron-usage-report',
      scheduleName: 'my-app-auth-service-usage-report',
    };

    it('should delete the revisions deploys registered, found by tag, after Terraform', async () => {
      rs.mocked(discoverAwsCronJobs).mockResolvedValue([usageReport]);
      const order: string[] = [];
      rs.mocked(executeTerraform).mockImplementation(async (command) => {
        order.push(command);
        return { success: true, output: '' };
      });
      rs.mocked(deleteEcsTaskDefinitionFamily).mockImplementation(async () => {
        order.push('task definitions');
        return { success: true, deleted: true };
      });

      await awsDestroy(mockCtx, { autoApprove: true });

      expect(deleteEcsTaskDefinitionFamily).toHaveBeenCalledWith({
        family: 'my-app-cron-usage-report',
        credentials: mockCtx.credentials,
      });
      expect(order).toEqual(['init', 'destroy', 'task definitions']);
    });

    it('should only warn when they cannot be listed or deleted', async () => {
      rs.mocked(discoverAwsCronJobs).mockRejectedValueOnce(
        new Error('AccessDenied'),
      );
      await awsDestroy(mockCtx, { autoApprove: true });
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "Could not list the cron jobs' task definitions: AccessDenied",
      );

      rs.mocked(discoverAwsCronJobs).mockResolvedValueOnce([usageReport]);
      rs.mocked(deleteEcsTaskDefinitionFamily).mockResolvedValueOnce({
        success: false,
        deleted: false,
        error: 'Throttled',
      });
      await awsDestroy(mockCtx, { autoApprove: true });
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Could not delete my-app-cron-usage-report: Throttled',
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        'Infrastructure destroyed successfully!',
      );
    });
  });

  it('should throw when terraform directory does not exist', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should prompt for confirmation when not auto-approved', async () => {
    await awsDestroy(mockCtx, {});

    expect(inquirer.prompt).toHaveBeenCalled();
  });

  it('should abort when user declines confirmation', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

    await awsDestroy(mockCtx, {});

    expect(executeTerraform).not.toHaveBeenCalledWith(
      'destroy',
      expect.anything(),
    );
  });

  it('should skip confirmation with autoApprove', async () => {
    await awsDestroy(mockCtx, { autoApprove: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(executeTerraform).toHaveBeenCalledWith('destroy', expect.anything());
  });

  it('should skip confirmation in CI', async () => {
    await awsDestroy({ ...mockCtx, runningInCI: true }, {});

    expect(inquirer.prompt).not.toHaveBeenCalled();
  });

  it('should run terraform init then destroy', async () => {
    await awsDestroy(mockCtx, { autoApprove: true });

    expect(executeTerraform).toHaveBeenCalledWith(
      'init',
      expect.objectContaining({ reconfigure: true }),
    );
    expect(executeTerraform).toHaveBeenCalledWith(
      'destroy',
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

    await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should throw when terraform destroy fails', async () => {
    rs.mocked(executeTerraform)
      .mockResolvedValueOnce({ success: true, output: '' })
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'destroy failed',
      });

    await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should log success on completion', async () => {
    await awsDestroy(mockCtx, { autoApprove: true });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Infrastructure destroyed successfully!',
    );
  });

  it('should disable ALB deletion protection before destroying', async () => {
    await awsDestroy(mockCtx, { autoApprove: true });

    expect(disableAlbDeletionProtection).toHaveBeenCalledWith(
      expect.objectContaining({ loadBalancerName: 'my-app-alb' }),
    );
    expect(
      rs.mocked(disableAlbDeletionProtection).mock.invocationCallOrder[0],
    ).toBeLessThan(rs.mocked(executeTerraform).mock.invocationCallOrder[0]);
  });

  it('should not run terraform when ALB protection cannot be disabled', async () => {
    rs.mocked(disableAlbDeletionProtection).mockResolvedValue({
      success: false,
      error: 'AccessDenied',
    });

    await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
      mocks.CliError,
    );
    expect(executeTerraform).not.toHaveBeenCalled();
  });

  it('should not touch the ALB when the user declines', async () => {
    rs.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

    await awsDestroy(mockCtx, {});

    expect(disableAlbDeletionProtection).not.toHaveBeenCalled();
  });

  it('should warn that storage files and logs are deleted too', async () => {
    await awsDestroy(mockCtx, {});

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Storage buckets (uploaded files), logs'),
    );
  });

  describe('with a database', () => {
    beforeEach(() => {
      rs.mocked(mocks.loadFrameworkConfig).mockReturnValue({
        services: [{ name: 'auth-service', hasDatabase: true }],
      } as unknown as ReturnType<typeof mocks.loadFrameworkConfig>);
      rs.mocked(disableDeletionProtection).mockResolvedValue({
        success: true,
      });
      rs.mocked(deleteCloudWatchLogGroup).mockResolvedValue({
        success: true,
        deleted: true,
      });
    });

    it("should delete the migration runs' log groups Terraform leaves", async () => {
      await awsDestroy(mockCtx, { autoApprove: true });

      expect(deleteCloudWatchLogGroup).toHaveBeenCalledWith({
        logGroupName: '/ecs/my-app/migrate-auth-service',
        credentials: mockCtx.credentials,
      });
      // And the name before the project was in it, from earlier deploys
      expect(deleteCloudWatchLogGroup).toHaveBeenCalledWith({
        logGroupName: '/ecs/migrate-auth-service-migration',
        credentials: mockCtx.credentials,
      });
    });

    it("should delete the VPC flow log's group again, which late records can make anew", async () => {
      await awsDestroy(mockCtx, { autoApprove: true });

      expect(deleteCloudWatchLogGroup).toHaveBeenCalledWith({
        logGroupName: '/aws/vpc/flowlogs/my-app',
        credentials: mockCtx.credentials,
      });
    });

    it('should only warn when a migration log group cannot be deleted', async () => {
      rs.mocked(deleteCloudWatchLogGroup).mockResolvedValue({
        success: false,
        deleted: false,
        error: 'AccessDenied',
      });

      await awsDestroy(mockCtx, { autoApprove: true });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Could not delete /ecs/migrate-auth-service-migration: AccessDenied',
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        'Infrastructure destroyed successfully!',
      );
    });

    it('should disable RDS deletion protection before destroying', async () => {
      await awsDestroy(mockCtx, { autoApprove: true });

      expect(disableDeletionProtection).toHaveBeenCalledWith(
        expect.objectContaining({ instanceIdentifier: 'my-app-db' }),
      );
    });

    it('should not run terraform when RDS protection cannot be disabled', async () => {
      rs.mocked(disableDeletionProtection).mockResolvedValue({
        success: false,
        error: 'AccessDenied',
      });

      await expect(awsDestroy(mockCtx, { autoApprove: true })).rejects.toThrow(
        mocks.CliError,
      );
      expect(executeTerraform).not.toHaveBeenCalled();
    });

    it('should point at the suffixed final snapshot and the password reset', async () => {
      await awsDestroy(mockCtx, { autoApprove: true });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('my-app-db-final-<suffix>'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('set a new master password'),
      );
      expect(mocks.logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Automated backups retained'),
      );
    });
  });
});
