import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteCloudRunJob } from './delete-cloud-run-job';

const mockDeleteJob = rs.fn();
const mockPromise = rs.fn();
rs.mock('@google-cloud/run', () => ({
  JobsClient: class MockJobsClient {
    deleteJob = mockDeleteJob;
  },
}));

rs.mock('../../../context', () => ({
  getContext: () => ({
    buildGCPClientOptions: (creds: unknown) => ({
      projectId: (creds as { project_id: string }).project_id,
    }),
  }),
}));

describe('deleteCloudRunJob', () => {
  const credentials = {
    project_id: 'test-project',
    region: 'us-central1',
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: 'mock-key',
  };
  const options = {
    jobName: 'migrate-auth-service',
    projectId: 'test-project',
    region: 'us-central1',
    credentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockPromise.mockResolvedValue([{}]);
    mockDeleteJob.mockResolvedValue([{ promise: mockPromise }]);
  });

  describe('Standard use cases', () => {
    it('should delete the job and wait for the operation', async () => {
      const result = await deleteCloudRunJob(options);

      expect(result).toEqual({ success: true, deleted: true });
      expect(mockDeleteJob).toHaveBeenCalledWith({
        name: 'projects/test-project/locations/us-central1/jobs/migrate-auth-service',
      });
      expect(mockPromise).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should treat NOT_FOUND as already gone', async () => {
      mockDeleteJob.mockRejectedValue(new Error('5 NOT_FOUND: Job not found'));

      const result = await deleteCloudRunJob(options);

      expect(result).toEqual({
        success: true,
        deleted: false,
        alreadyGone: true,
      });
    });

    it('should report other errors', async () => {
      mockDeleteJob.mockRejectedValue(new Error('7 PERMISSION_DENIED'));

      const result = await deleteCloudRunJob(options);

      expect(result).toEqual({
        success: false,
        deleted: false,
        error: '7 PERMISSION_DENIED',
      });
    });

    it('should report a failed operation', async () => {
      mockPromise.mockRejectedValue(new Error('13 INTERNAL'));

      const result = await deleteCloudRunJob(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('13 INTERNAL');
    });
  });
});
