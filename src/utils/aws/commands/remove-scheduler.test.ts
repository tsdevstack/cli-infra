/**
 * Tests for awsRemoveScheduler
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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

rs.mock('../delete/delete-scheduler-schedule', () => ({
  deleteSchedulerSchedule: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

import { awsRemoveScheduler } from './remove-scheduler';
import { deleteSchedulerSchedule } from '../delete/delete-scheduler-schedule';
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

  describe('infrastructure cleanup warning', () => {
    it('should warn about infrastructure.json cleanup', async () => {
      await awsRemoveScheduler(mockCtx, {
        job: 'my-app-auth-service-cleanup-tokens',
        confirm: true,
      });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('infrastructure.json'),
      );
    });
  });
});
