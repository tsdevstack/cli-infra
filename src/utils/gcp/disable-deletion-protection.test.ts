/**
 * Tests for disable-deletion-protection (GCP)
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { disableDeletionProtection } from './disable-deletion-protection';

// Mock googleapis
const mockGet = rs.fn();
const mockPatch = rs.fn();

rs.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: rs.fn().mockImplementation(() => ({})),
    },
    sqladmin: () => ({
      instances: {
        get: mockGet,
        patch: mockPatch,
      },
    }),
  },
}));

const baseOptions = {
  instanceName: 'test-project-postgres',
  projectId: 'test-project-id',
  credentials: {
    project_id: 'test-project-id',
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: 'test-key',
    region: 'us-central1',
  },
};

describe('disableDeletionProtection', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
  });

  describe('when deletion protection is enabled', () => {
    it('should disable it and return success', async () => {
      mockGet.mockResolvedValue({
        data: {
          settings: { deletionProtectionEnabled: true },
        },
      });
      mockPatch.mockResolvedValue({});

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBeUndefined();
      expect(mockPatch).toHaveBeenCalled();
    });
  });

  describe('when deletion protection is already disabled', () => {
    it('should return success with wasAlreadyDisabled', async () => {
      mockGet.mockResolvedValue({
        data: {
          settings: { deletionProtectionEnabled: false },
        },
      });

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
      expect(mockPatch).not.toHaveBeenCalled();
    });
  });

  describe('when instance does not exist', () => {
    it('should return success with wasAlreadyDisabled', async () => {
      const error = new Error('Not found') as Error & { code: number };
      error.code = 404;
      mockGet.mockRejectedValue(error);

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(true);
      expect(result.wasAlreadyDisabled).toBe(true);
    });
  });

  describe('when API call fails', () => {
    it('should return failure with error message', async () => {
      mockGet.mockRejectedValue(new Error('Permission denied'));

      const result = await disableDeletionProtection(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });
  });
});
