/**
 * Tests for gcpRemoveScheduler
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../naming/resolve-gcp-naming-scheme', () => ({
  resolveGcpNamingScheme: rs.fn(async () => 'legacy'),
}));

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
const mockDeleteCloudRunJob = rs.fn();
rs.mock('../delete', () => ({
  deleteSchedulerJob: (...args: unknown[]) => mockDeleteSchedulerJob(...args),
  deleteCloudRunJob: (...args: unknown[]) => mockDeleteCloudRunJob(...args),
}));

const mockDiscoverCronJobs = rs.fn();
rs.mock('../discovery/discover-cron-jobs', () => ({
  discoverCronJobs: (...args: unknown[]) => mockDiscoverCronJobs(...args),
}));

const mockListJobs = rs.fn();
rs.mock('@google-cloud/scheduler', () => {
  return {
    CloudSchedulerClient: class {
      listJobs = (...args: unknown[]) => mockListJobs(...args);
    },
  };
});

const mockRemind = rs.fn();
rs.mock('../../infrastructure/remind-to-remove-scheduled-job-entry', () => ({
  remindToRemoveScheduledJobEntry: (...args: unknown[]) => mockRemind(...args),
}));

import { gcpRemoveScheduler } from './remove-scheduler';
import { resolveGcpNamingScheme } from '../naming/resolve-gcp-naming-scheme';

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
    mockDeleteCloudRunJob.mockResolvedValue({ success: true, deleted: true });
    mockDiscoverCronJobs.mockResolvedValue([]);
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
  });

  describe('unique naming scheme', () => {
    const job = (name: string, description?: string) => ({
      name: `projects/gcp-project-123/locations/us-central1/jobs/${name}`,
      description,
      schedule: '0 0 * * *',
      state: 'ENABLED',
    });

    beforeEach(() => {
      rs.mocked(resolveGcpNamingScheme).mockResolvedValue('unique');
      mockDeleteSchedulerJob.mockResolvedValue({
        success: true,
        deleted: true,
      });
    });

    it("should offer only this project's jobs, by their config names", async () => {
      mockListJobs.mockResolvedValue([
        [
          job('my-app-cleanup-tokens', 'tsdevstack project: my-app'),
          job('my-app-admin-cleanup', 'tsdevstack project: my-app-admin'),
          job('my-app-old-job'),
        ],
      ]);
      mockInquirerPrompt
        .mockResolvedValueOnce({ selectedJob: 'cleanup-tokens' })
        .mockResolvedValueOnce({ confirmed: true });

      await gcpRemoveScheduler(mockCtx, {});

      const choices = mockInquirerPrompt.mock.calls[0][0][0].choices;
      expect(choices.map((c: { value: string }) => c.value)).toEqual([
        'cleanup-tokens',
        '__manual__',
      ]);
      expect(mockDeleteSchedulerJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobName: 'my-app-cleanup-tokens' }),
      );
    });
  });
  describe('cron jobs', () => {
    // Found by their labels: infrastructure.json is not read at all
    const cronJobs = [
      {
        name: 'usage-report',
        serviceName: 'auth-service',
        cloudRunJobName: 'cron-usage-report',
        schedulerJobName: 'usage-report',
      },
    ];

    it("should delete a cron job's Cloud Run Job, found by its labels, after its schedule", async () => {
      mockDiscoverCronJobs.mockResolvedValue(cronJobs);
      const order: string[] = [];
      mockDeleteSchedulerJob.mockImplementation(async () => {
        order.push('schedule');
        return { success: true, deleted: true };
      });
      mockDeleteCloudRunJob.mockImplementation(async () => {
        order.push('job');
        return { success: true, deleted: true };
      });

      await gcpRemoveScheduler(mockCtx, { job: 'usage-report' });

      expect(mockDiscoverCronJobs).toHaveBeenCalledWith({
        projectName: 'my-app',
        naming: 'legacy',
        credentials: mockCredentials,
      });
      expect(mockDeleteSchedulerJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobName: 'usage-report' }),
      );
      expect(mockDeleteCloudRunJob).toHaveBeenCalledWith({
        jobName: 'cron-usage-report',
        projectId: 'gcp-project-123',
        region: 'us-central1',
        credentials: mockCredentials,
      });
      expect(order).toEqual(['schedule', 'job']);
    });

    it('should delete the Cloud Run Job when the schedule is already gone', async () => {
      mockDiscoverCronJobs.mockResolvedValue(cronJobs);
      mockDeleteSchedulerJob.mockResolvedValue({
        success: true,
        deleted: false,
      });

      await gcpRemoveScheduler(mockCtx, { job: 'usage-report' });

      expect(mockDeleteCloudRunJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobName: 'cron-usage-report' }),
      );
    });

    it('should leave the Cloud Run Jobs alone for a trigger', async () => {
      mockDiscoverCronJobs.mockResolvedValue(cronJobs);

      await gcpRemoveScheduler(mockCtx, { job: 'cleanup-tokens' });

      expect(mockDeleteCloudRunJob).not.toHaveBeenCalled();
    });

    it("should delete nothing when the cron jobs can't be listed", async () => {
      mockDiscoverCronJobs.mockRejectedValue(
        new Error('7 PERMISSION_DENIED: run.jobs.list'),
      );

      await expect(
        gcpRemoveScheduler(mockCtx, { job: 'usage-report' }),
      ).rejects.toMatchObject({
        message: "Could not list the cron jobs' Cloud Run Jobs",
        hint: '7 PERMISSION_DENIED: run.jobs.list. Nothing was deleted; run the command again.',
      });
      expect(mockDeleteSchedulerJob).not.toHaveBeenCalled();
      expect(mockDeleteCloudRunJob).not.toHaveBeenCalled();
    });
  });
  describe('Entry reminder', () => {
    it("should match the entry by the job's name", async () => {
      await gcpRemoveScheduler(mockCtx, {
        job: 'cleanup-tokens',
        confirm: true,
      });

      expect(mockRemind).toHaveBeenCalledWith('prod', expect.any(Function));
      const isRemovedJob = mockRemind.mock.calls[0][1] as (entry: {
        name: string;
      }) => boolean;
      expect(isRemovedJob({ name: 'cleanup-tokens' })).toBe(true);
      expect(isRemovedJob({ name: 'usage-report' })).toBe(false);
    });
  });
});
