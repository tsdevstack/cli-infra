import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteSchedulerJob } from './delete-scheduler-job';

// Mock @google-cloud/scheduler
const mockDeleteJob = rs.fn();
rs.mock('@google-cloud/scheduler', () => {
  return {
    CloudSchedulerClient: class MockCloudSchedulerClient {
      deleteJob = mockDeleteJob;
    },
  };
});

// Mock context
rs.mock('../../../context', () => ({
  getContext: () => ({
    buildGCPClientOptions: (creds: unknown) => ({
      projectId: (creds as { project_id: string }).project_id,
    }),
  }),
}));

describe('deleteSchedulerJob', () => {
  const mockCredentials = {
    project_id: 'test-project',
    region: 'us-central1',
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: 'mock-key',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockDeleteJob.mockResolvedValue({});
  });

  describe('Successful deletion', () => {
    it('should delete a scheduler job successfully', async () => {
      const result = await deleteSchedulerJob({
        jobName: 'cleanup-tokens',
        projectId: 'test-project',
        region: 'us-central1',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.alreadyGone).toBeUndefined();
      expect(result.error).toBeUndefined();

      // Verify the correct full path is used
      expect(mockDeleteJob).toHaveBeenCalledWith({
        name: 'projects/test-project/locations/us-central1/jobs/cleanup-tokens',
      });
    });

    it('should handle different job names and regions', async () => {
      const result = await deleteSchedulerJob({
        jobName: 'daily-report',
        projectId: 'another-project',
        region: 'europe-west1',
        credentials: {
          ...mockCredentials,
          project_id: 'another-project',
          region: 'europe-west1',
        },
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);

      expect(mockDeleteJob).toHaveBeenCalledWith({
        name: 'projects/another-project/locations/europe-west1/jobs/daily-report',
      });
    });
  });

  describe('Idempotency', () => {
    it('should treat NOT_FOUND as success (already deleted)', async () => {
      mockDeleteJob.mockRejectedValue(new Error('5 NOT_FOUND: Job not found'));

      const result = await deleteSchedulerJob({
        jobName: 'nonexistent-job',
        projectId: 'test-project',
        region: 'us-central1',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.alreadyGone).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should return error on permission denied', async () => {
      mockDeleteJob.mockRejectedValue(new Error('Permission denied'));

      const result = await deleteSchedulerJob({
        jobName: 'protected-job',
        projectId: 'test-project',
        region: 'us-central1',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('Permission denied');
    });

    it('should return error on API failure', async () => {
      mockDeleteJob.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await deleteSchedulerJob({
        jobName: 'test-job',
        projectId: 'test-project',
        region: 'us-central1',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
    });

    it('should handle non-Error throws', async () => {
      mockDeleteJob.mockRejectedValue('unknown error');

      const result = await deleteSchedulerJob({
        jobName: 'test-job',
        projectId: 'test-project',
        region: 'us-central1',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });
});
