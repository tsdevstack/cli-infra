/**
 * Tests for gcpRemoveScheduler
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

const mockInquirerPrompt = rs.fn();
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirerPrompt(...args),
  },
}));

const mockDeleteSchedulerJob = rs.fn();
rs.mock('../delete', () => ({
  deleteSchedulerJob: (...args: unknown[]) => mockDeleteSchedulerJob(...args),
}));

const mockListJobs = rs.fn();
rs.mock('@google-cloud/scheduler', () => {
  return {
    CloudSchedulerClient: class {
      listJobs = (...args: unknown[]) => mockListJobs(...args);
    },
  };
});

import { gcpRemoveScheduler } from './remove-scheduler';

describe('gcpRemoveScheduler', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    client_email: 'test@gcp-project-123.iam.gserviceaccount.com',
    region: 'us-central1',
  };

  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'prod',
    credentials: mockCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.buildGCPClientOptions.mockReturnValue({ credentials: {} });
    mockDeleteSchedulerJob.mockResolvedValue({ success: true, deleted: true });
    mockInquirerPrompt.mockResolvedValue({ confirmed: true });
  });

  describe('with job name provided', () => {
    it('should delete specified job', async () => {
      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mockDeleteSchedulerJob).toHaveBeenCalledWith({
        jobName: 'cleanup-tokens',
        projectId: 'gcp-project-123',
        region: 'us-central1',
        credentials: mockCredentials,
      });
    });
  });

  describe('interactive selection', () => {
    beforeEach(() => {
      mockListJobs.mockResolvedValue([
        [
          {
            name: 'projects/gcp-project-123/locations/us-central1/jobs/cleanup-tokens',
            schedule: '0 0 * * *',
            state: 'ENABLED',
            httpTarget: { uri: 'https://example.com/cleanup' },
          },
          {
            name: 'projects/gcp-project-123/locations/us-central1/jobs/daily-report',
            schedule: '0 8 * * *',
            state: 'PAUSED',
            httpTarget: { uri: 'https://example.com/report' },
          },
        ],
      ]);
      mockInquirerPrompt
        .mockResolvedValueOnce({ selectedJob: 'cleanup-tokens' })
        .mockResolvedValueOnce({ confirmed: true });
    });

    it('should query Cloud Scheduler for deployed jobs', async () => {
      await gcpRemoveScheduler(mockCtx, {});

      expect(mockListJobs).toHaveBeenCalledWith({
        parent: 'projects/gcp-project-123/locations/us-central1',
      });
    });

    it('should display job choices with schedule and state', async () => {
      await gcpRemoveScheduler(mockCtx, {});

      const promptCall = mockInquirerPrompt.mock.calls[0][0][0];
      const choices = promptCall.choices;

      expect(choices).toEqual([
        {
          name: 'cleanup-tokens (0 0 * * *) - ENABLED',
          value: 'cleanup-tokens',
        },
        { name: 'daily-report (0 8 * * *) - PAUSED', value: 'daily-report' },
        { name: '[ Enter job name manually ]', value: '__manual__' },
      ]);
    });

    it('should throw when no jobs found', async () => {
      mockListJobs.mockResolvedValue([[]]);

      await expect(gcpRemoveScheduler(mockCtx, {})).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when list fails', async () => {
      mockListJobs.mockRejectedValue(new Error('API error'));

      await expect(gcpRemoveScheduler(mockCtx, {})).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should support manual entry', async () => {
      mockInquirerPrompt.mockReset();
      mockInquirerPrompt
        .mockResolvedValueOnce({ selectedJob: '__manual__' })
        .mockResolvedValueOnce({ enteredJobName: 'custom-job' })
        .mockResolvedValueOnce({ confirmed: true });

      await gcpRemoveScheduler(mockCtx, {});

      expect(mockDeleteSchedulerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobName: 'custom-job',
        }),
      );
    });
  });

  describe('confirmation prompt', () => {
    it('should prompt for confirmation in interactive mode', async () => {
      mockInquirerPrompt.mockResolvedValue({ confirmed: true });

      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mockInquirerPrompt).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'confirm',
          name: 'confirmed',
          message: expect.stringContaining('cleanup-tokens'),
        }),
      ]);
    });

    it('should abort when user declines', async () => {
      mockInquirerPrompt.mockResolvedValue({ confirmed: false });

      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mockDeleteSchedulerJob).not.toHaveBeenCalled();
    });

    it('should skip confirmation in CI mode', async () => {
      const ciCtx = { ...mockCtx, runningInCI: true };

      await gcpRemoveScheduler(ciCtx, {
        job: 'cleanup-tokens',
        confirm: true,
      });

      // Should not prompt for confirmation
      expect(mockInquirerPrompt).not.toHaveBeenCalled();
      expect(mockDeleteSchedulerJob).toHaveBeenCalled();
    });
  });

  describe('deletion', () => {
    it('should throw when deletion fails', async () => {
      mockDeleteSchedulerJob.mockResolvedValue({
        success: false,
        error: 'Permission denied',
      });

      await expect(
        gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should handle already deleted job', async () => {
      mockDeleteSchedulerJob.mockResolvedValue({
        success: true,
        deleted: false,
      });

      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
      );
    });
  });

  describe('logging', () => {
    it('should log job info', async () => {
      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Job: cleanup-tokens'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Environment: prod'),
      );
    });

    it('should log success message', async () => {
      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('removed from prod'),
      );
    });

    it('should warn about infrastructure.json cleanup', async () => {
      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('infrastructure.json'),
      );
    });
  });
});
