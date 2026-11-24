/**
 * Tests for awsRemoveScheduler
 */

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

rs.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListSchedulesCommand: rs.fn(),
}));

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

rs.mock('../discovery/discover-aws-cron-jobs', () => ({
  discoverAwsCronJobs: rs.fn(),
}));

rs.mock('../delete', () => ({
  deleteEcsTaskDefinitionFamily: rs.fn(),
  deleteCloudWatchLogGroup: rs.fn(),
  deleteSchedulerSchedule: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

const mockRemind = rs.fn();
rs.mock('../../infrastructure/remind-to-remove-scheduled-job-entry', () => ({
  remindToRemoveScheduledJobEntry: (...args: unknown[]) => mockRemind(...args),
}));

/** The predicate the command handed the entry reminder */
function remindedEntry(): (entry: {
  name: string;
  targetService: string;
}) => boolean {
  expect(mockRemind).toHaveBeenCalledWith('dev', expect.any(Function));
  return mockRemind.mock.calls[0][1] as (entry: {
    name: string;
    targetService: string;
  }) => boolean;
}

import { awsRemoveScheduler } from './remove-scheduler';
import {
  deleteCloudWatchLogGroup,
  deleteEcsTaskDefinitionFamily,
  deleteSchedulerSchedule,
} from '../delete';
import { discoverAwsCronJobs } from '../discovery/discover-aws-cron-jobs';
import inquirer from 'inquirer';

describe('awsRemoveScheduler', () => {
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
    rs.clearAllMocks();
    mockSend.mockReset();
    rs.mocked(deleteSchedulerSchedule).mockResolvedValue({
      success: true,
      deleted: true,
    });
    rs.mocked(discoverAwsCronJobs).mockResolvedValue([]);
    rs.mocked(deleteEcsTaskDefinitionFamily).mockResolvedValue({
      success: true,
      deleted: true,
    });
    rs.mocked(deleteCloudWatchLogGroup).mockResolvedValue({
      success: true,
      deleted: true,
    });
  });

  describe('Cron jobs', () => {
    // Found by their task definitions' tags: infrastructure.json is not read
    const usageReport = {
      name: 'usage-report',
      serviceName: 'auth-service',
      taskFamily: 'my-app-cron-usage-report',
      containerName: 'cron-usage-report',
      logGroupName: '/ecs/my-app/cron-usage-report',
      scheduleName: 'my-app-auth-service-usage-report',
    };

    it("should delete a cron job's schedule, then its task definition and log group", async () => {
      rs.mocked(discoverAwsCronJobs).mockResolvedValue([usageReport]);
      const order: string[] = [];
      rs.mocked(deleteSchedulerSchedule).mockImplementation(async () => {
        order.push('schedule');
        return { success: true, deleted: true };
      });
      rs.mocked(deleteEcsTaskDefinitionFamily).mockImplementation(async () => {
        order.push('task definition');
        return { success: true, deleted: true };
      });
      rs.mocked(deleteCloudWatchLogGroup).mockImplementation(async () => {
        order.push('log group');
        return { success: true, deleted: true };
      });

      await awsRemoveScheduler(mockCtx, {
        job: 'my-app-auth-service-usage-report',
        confirm: true,
      });

      expect(discoverAwsCronJobs).toHaveBeenCalledWith({
        projectName: 'my-app',
        credentials: mockCtx.credentials,
      });
      expect(deleteEcsTaskDefinitionFamily).toHaveBeenCalledWith({
        family: 'my-app-cron-usage-report',
        credentials: mockCtx.credentials,
      });
      expect(deleteCloudWatchLogGroup).toHaveBeenCalledWith({
        logGroupName: '/ecs/my-app/cron-usage-report',
        credentials: mockCtx.credentials,
      });
      expect(order).toEqual(['schedule', 'task definition', 'log group']);
    });

    it("should also take the cron job's own name", async () => {
      rs.mocked(discoverAwsCronJobs).mockResolvedValue([usageReport]);

      await awsRemoveScheduler(mockCtx, { job: 'usage-report', confirm: true });

      expect(deleteSchedulerSchedule).toHaveBeenCalledWith({
        scheduleName: 'my-app-auth-service-usage-report',
        credentials: mockCtx.credentials,
      });
      expect(deleteEcsTaskDefinitionFamily).toHaveBeenCalled();
    });

    it("should leave task definitions and log groups alone for a trigger's schedule", async () => {
      rs.mocked(discoverAwsCronJobs).mockResolvedValue([usageReport]);

      await awsRemoveScheduler(mockCtx, {
        job: 'my-app-auth-service-cleanup-tokens',
        confirm: true,
      });

      expect(deleteEcsTaskDefinitionFamily).not.toHaveBeenCalled();
      expect(deleteCloudWatchLogGroup).not.toHaveBeenCalled();
    });

    it("should delete nothing when the cron jobs can't be listed", async () => {
      rs.mocked(discoverAwsCronJobs).mockRejectedValue(
        new Error('AccessDenied'),
      );

      await expect(
        awsRemoveScheduler(mockCtx, { job: 'usage-report', confirm: true }),
      ).rejects.toMatchObject({
        message: "Could not list the cron jobs' task definitions",
        hint: 'AccessDenied. Nothing was deleted; run the command again.',
      });
      expect(deleteSchedulerSchedule).not.toHaveBeenCalled();
    });
  });

  describe('CI mode', () => {
    it('should delete schedule by name in CI mode', async () => {
      await awsRemoveScheduler(mockCtx, {
        job: 'my-app-auth-service-cleanup-tokens',
        confirm: true,
      });

      expect(deleteSchedulerSchedule).toHaveBeenCalledWith({
        scheduleName: 'my-app-auth-service-cleanup-tokens',
        credentials: mockCtx.credentials,
      });
    });

    it('should log success when schedule is deleted', async () => {
      await awsRemoveScheduler(mockCtx, {
        job: 'my-app-auth-service-cleanup-tokens',
        confirm: true,
      });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('my-app-auth-service-cleanup-tokens'),
      );
    });

    it('should log info when schedule already deleted', async () => {
      rs.mocked(deleteSchedulerSchedule).mockResolvedValue({
        success: true,
        deleted: false,
      });

      await awsRemoveScheduler(mockCtx, {
        job: 'my-app-auth-service-cleanup-tokens',
        confirm: true,
      });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
      );
    });

    it('should throw when delete fails', async () => {
      rs.mocked(deleteSchedulerSchedule).mockResolvedValue({
        success: false,
        deleted: false,
        error: 'Access denied',
      });

      await expect(
        awsRemoveScheduler(mockCtx, {
          job: 'my-app-auth-service-cleanup-tokens',
          confirm: true,
        }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('interactive mode', () => {
    const interactiveCtx = { ...mockCtx, runningInCI: false };

    it('should discover and present schedules for selection', async () => {
      mockSend.mockResolvedValue({
        Schedules: [
          { Name: 'my-app-auth-service-cleanup-tokens', State: 'ENABLED' },
          { Name: 'my-app-offers-service-sync-prices', State: 'ENABLED' },
        ],
        NextToken: undefined,
      });

      rs.mocked(inquirer.prompt)
        .mockResolvedValueOnce({
          selectedSchedule: 'my-app-auth-service-cleanup-tokens',
        })
        .mockResolvedValueOnce({ confirmed: true });

      await awsRemoveScheduler(interactiveCtx, {});

      expect(deleteSchedulerSchedule).toHaveBeenCalledWith({
        scheduleName: 'my-app-auth-service-cleanup-tokens',
        credentials: interactiveCtx.credentials,
      });
    });

    it('should abort when user declines confirmation', async () => {
      mockSend.mockResolvedValue({
        Schedules: [
          { Name: 'my-app-auth-service-cleanup-tokens', State: 'ENABLED' },
        ],
        NextToken: undefined,
      });

      rs.mocked(inquirer.prompt)
        .mockResolvedValueOnce({
          selectedSchedule: 'my-app-auth-service-cleanup-tokens',
        })
        .mockResolvedValueOnce({ confirmed: false });

      await awsRemoveScheduler(interactiveCtx, {});

      expect(deleteSchedulerSchedule).not.toHaveBeenCalled();
      expect(mocks.logger.info).toHaveBeenCalledWith('Aborted.');
    });

    it('should throw when no deployed schedules found', async () => {
      mockSend.mockResolvedValue({
        Schedules: [],
        NextToken: undefined,
      });

      await expect(awsRemoveScheduler(interactiveCtx, {})).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should handle manual entry selection', async () => {
      mockSend.mockResolvedValue({
        Schedules: [
          { Name: 'my-app-auth-service-cleanup-tokens', State: 'ENABLED' },
        ],
        NextToken: undefined,
      });

      rs.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ selectedSchedule: '__manual__' })
        .mockResolvedValueOnce({ enteredName: 'custom-schedule-name' })
        .mockResolvedValueOnce({ confirmed: true });

      await awsRemoveScheduler(interactiveCtx, {});

      expect(deleteSchedulerSchedule).toHaveBeenCalledWith({
        scheduleName: 'custom-schedule-name',
        credentials: interactiveCtx.credentials,
      });
    });
  });

  describe('Entry reminder', () => {
    const cleanupTokens = {
      name: 'cleanup-tokens',
      targetService: 'auth-service',
    };
    const usageReport = { name: 'usage-report', targetService: 'auth-service' };

    it("should match a trigger's entry by its schedule's name", async () => {
      await awsRemoveScheduler(mockCtx, {
        job: 'my-app-auth-service-cleanup-tokens',
        confirm: true,
      });

      const isRemovedJob = remindedEntry();
      expect(isRemovedJob(cleanupTokens)).toBe(true);
      expect(isRemovedJob(usageReport)).toBe(false);
    });

    it("should match a cron job's entry through its task definition's name", async () => {
      rs.mocked(discoverAwsCronJobs).mockResolvedValue([
        {
          name: 'usage-report',
          serviceName: 'auth-service',
          taskFamily: 'my-app-cron-usage-report',
          containerName: 'cron-usage-report',
          logGroupName: '/ecs/my-app/cron-usage-report',
          scheduleName: 'my-app-auth-service-usage-report',
        },
      ]);

      await awsRemoveScheduler(mockCtx, { job: 'usage-report', confirm: true });

      const isRemovedJob = remindedEntry();
      expect(isRemovedJob(usageReport)).toBe(true);
      expect(isRemovedJob(cleanupTokens)).toBe(false);
    });
  });
});
