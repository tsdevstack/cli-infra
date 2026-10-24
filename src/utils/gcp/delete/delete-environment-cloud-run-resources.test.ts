import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockDeleteCloudRunService = rs.fn();
const mockDeleteCloudRunJob = rs.fn();
rs.mock('./delete-cloud-run-service', () => ({
  deleteCloudRunService: (...args: unknown[]) =>
    mockDeleteCloudRunService(...args),
}));
rs.mock('./delete-cloud-run-job', () => ({
  deleteCloudRunJob: (...args: unknown[]) => mockDeleteCloudRunJob(...args),
}));

import { deleteEnvironmentCloudRunResources } from './delete-environment-cloud-run-resources';

describe('deleteEnvironmentCloudRunResources', () => {
  const credentials = {
    project_id: 'test-project',
    region: 'us-central1',
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: 'mock-key',
  };
  const base = {
    credentials,
    projectId: 'test-project',
    region: 'us-central1',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockDeleteCloudRunService.mockResolvedValue({
      success: true,
      deleted: true,
    });
    mockDeleteCloudRunJob.mockResolvedValue({ success: true, deleted: true });
  });

  describe('Standard use cases', () => {
    it('should delete every service and job', async () => {
      const result = await deleteEnvironmentCloudRunResources({
        ...base,
        names: {
          services: ['auth-service', 'my-app-kong'],
          jobs: ['migrate-auth-service'],
        },
      });

      expect(result).toEqual({
        deleted: ['auth-service', 'my-app-kong', 'migrate-auth-service'],
        notFound: [],
        failed: [],
      });
      expect(mockDeleteCloudRunService).toHaveBeenCalledWith({
        serviceName: 'my-app-kong',
        projectId: 'test-project',
        region: 'us-central1',
        credentials,
      });
      expect(mockDeleteCloudRunJob).toHaveBeenCalledWith({
        jobName: 'migrate-auth-service',
        projectId: 'test-project',
        region: 'us-central1',
        credentials,
      });
    });

    it('should start every deletion before any finishes (parallel)', async () => {
      const started: string[] = [];
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockDeleteCloudRunService.mockImplementation(
        async ({ serviceName }: { serviceName: string }) => {
          started.push(serviceName);
          await gate;
          return { success: true, deleted: true };
        },
      );

      const pending = deleteEnvironmentCloudRunResources({
        ...base,
        names: { services: ['a', 'b', 'c'], jobs: [] },
      });
      await Promise.resolve();
      expect(started).toEqual(['a', 'b', 'c']);
      release();
      await pending;
    });
  });

  describe('Edge cases', () => {
    it('should list resources that do not exist as not found', async () => {
      mockDeleteCloudRunService.mockResolvedValue({
        success: true,
        deleted: false,
        alreadyGone: true,
      });
      mockDeleteCloudRunJob.mockResolvedValue({
        success: true,
        deleted: false,
        alreadyGone: true,
      });

      const result = await deleteEnvironmentCloudRunResources({
        ...base,
        names: { services: ['auth-service'], jobs: ['migrate-auth-service'] },
      });

      expect(result).toEqual({
        deleted: [],
        notFound: ['auth-service', 'migrate-auth-service'],
        failed: [],
      });
    });

    it('should report failures without stopping the other deletions', async () => {
      mockDeleteCloudRunService.mockImplementation(
        async ({ serviceName }: { serviceName: string }) =>
          serviceName === 'frontend'
            ? { success: false, deleted: false, error: 'PERMISSION_DENIED' }
            : { success: true, deleted: true },
      );

      const result = await deleteEnvironmentCloudRunResources({
        ...base,
        names: { services: ['frontend', 'my-app-kong'], jobs: [] },
      });

      expect(result).toEqual({
        deleted: ['my-app-kong'],
        notFound: [],
        failed: [{ name: 'frontend', error: 'PERMISSION_DENIED' }],
      });
    });

    it('should do nothing without names', async () => {
      const result = await deleteEnvironmentCloudRunResources({
        ...base,
        names: { services: [], jobs: [] },
      });

      expect(result).toEqual({ deleted: [], notFound: [], failed: [] });
      expect(mockDeleteCloudRunService).not.toHaveBeenCalled();
    });
  });
});
