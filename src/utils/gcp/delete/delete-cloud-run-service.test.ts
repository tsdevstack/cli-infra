import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteCloudRunService } from './delete-cloud-run-service';

const mockDeleteService = rs.fn();
const mockPromise = rs.fn();
rs.mock('@google-cloud/run', () => ({
  ServicesClient: class MockServicesClient {
    deleteService = mockDeleteService;
  },
}));

rs.mock('../../../context', () => ({
  getContext: () => ({
    buildGCPClientOptions: (creds: unknown) => ({
      projectId: (creds as { project_id: string }).project_id,
    }),
  }),
}));

describe('deleteCloudRunService', () => {
  const credentials = {
    project_id: 'test-project',
    region: 'us-central1',
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: 'mock-key',
  };
  const options = {
    serviceName: 'auth-service',
    projectId: 'test-project',
    region: 'us-central1',
    credentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockPromise.mockResolvedValue([{}]);
    mockDeleteService.mockResolvedValue([{ promise: mockPromise }]);
  });

  describe('Standard use cases', () => {
    it('should delete the service and wait for the operation', async () => {
      const result = await deleteCloudRunService(options);

      expect(result).toEqual({ success: true, deleted: true });
      expect(mockDeleteService).toHaveBeenCalledWith({
        name: 'projects/test-project/locations/us-central1/services/auth-service',
      });
      expect(mockPromise).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should treat NOT_FOUND as already gone', async () => {
      mockDeleteService.mockRejectedValue(
        new Error('5 NOT_FOUND: Service not found'),
      );

      const result = await deleteCloudRunService(options);

      expect(result).toEqual({
        success: true,
        deleted: false,
        alreadyGone: true,
      });
    });

    it('should report other errors', async () => {
      mockDeleteService.mockRejectedValue(new Error('7 PERMISSION_DENIED'));

      const result = await deleteCloudRunService(options);

      expect(result).toEqual({
        success: false,
        deleted: false,
        error: '7 PERMISSION_DENIED',
      });
    });
  });
});
