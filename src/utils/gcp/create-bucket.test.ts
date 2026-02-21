import { describe, it, expect, rs, beforeEach } from '@rstest/core';

// Use rs.hoisted to create mocks that will be hoisted along with rs.mock
const mocks = rs.hoisted(() => {
  return {
    exists: rs.fn(),
    createBucket: rs.fn(),
  };
});

rs.mock('@google-cloud/storage', () => {
  return {
    Storage: class MockStorage {
      bucket() {
        return { exists: mocks.exists };
      }
      createBucket(...args: unknown[]) {
        return mocks.createBucket(...args);
      }
    },
  };
});

// Mock the context to provide buildGCPClientOptions
rs.mock('../../context', () => ({
  getContext: () => ({
    buildGCPClientOptions: () => ({
      projectId: 'test-project',
    }),
  }),
}));

import { createBucket } from './create-bucket';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

describe('createBucket', () => {
  const mockCredentials: GCPCredentials = {
    project_id: 'test-project',
    region: 'us-central1',
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: 'private-key',
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('when bucket already exists', () => {
    it('should return success with isNew=false', async () => {
      mocks.exists!.mockResolvedValue([true]);

      const result = await createBucket({
        bucketName: 'existing-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.isNew).toBe(false);
      expect(result.bucketName).toBe('existing-bucket');
    });

    it('should not attempt to create bucket', async () => {
      mocks.exists!.mockResolvedValue([true]);

      await createBucket({
        bucketName: 'existing-bucket',
        credentials: mockCredentials,
      });

      expect(mocks.createBucket).not.toHaveBeenCalled();
    });
  });

  describe('when bucket does not exist', () => {
    beforeEach(() => {
      mocks.exists!.mockResolvedValue([false]);
      mocks.createBucket!.mockResolvedValue([{}]);
    });

    it('should create bucket and return success with isNew=true', async () => {
      const result = await createBucket({
        bucketName: 'new-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.isNew).toBe(true);
      expect(result.bucketName).toBe('new-bucket');
    });

    it('should create bucket with default options', async () => {
      await createBucket({
        bucketName: 'new-bucket',
        credentials: mockCredentials,
      });

      expect(mocks.createBucket).toHaveBeenCalledWith('new-bucket', {
        location: 'US',
        storageClass: 'STANDARD',
        versioning: { enabled: false },
        labels: { 'managed-by': 'tsdevstack' },
      });
    });

    it('should create bucket with custom location', async () => {
      await createBucket({
        bucketName: 'new-bucket',
        credentials: mockCredentials,
        location: 'EU',
      });

      expect(mocks.createBucket).toHaveBeenCalledWith(
        'new-bucket',
        expect.objectContaining({ location: 'EU' }),
      );
    });

    it('should create bucket with versioning enabled', async () => {
      await createBucket({
        bucketName: 'new-bucket',
        credentials: mockCredentials,
        versioning: true,
      });

      expect(mocks.createBucket).toHaveBeenCalledWith(
        'new-bucket',
        expect.objectContaining({ versioning: { enabled: true } }),
      );
    });

    it('should create bucket with custom labels', async () => {
      await createBucket({
        bucketName: 'new-bucket',
        credentials: mockCredentials,
        labels: { environment: 'prod', team: 'platform' },
      });

      expect(mocks.createBucket).toHaveBeenCalledWith(
        'new-bucket',
        expect.objectContaining({
          labels: {
            'managed-by': 'tsdevstack',
            environment: 'prod',
            team: 'platform',
          },
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should return error when exists check fails', async () => {
      mocks.exists!.mockRejectedValue(new Error('Permission denied'));

      const result = await createBucket({
        bucketName: 'test-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
      expect(result.isNew).toBe(false);
    });

    it('should return error when bucket creation fails', async () => {
      mocks.exists!.mockResolvedValue([false]);
      mocks.createBucket!.mockRejectedValue(
        new Error('Bucket name already taken'),
      );

      const result = await createBucket({
        bucketName: 'test-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bucket name already taken');
    });

    it('should handle unknown error type', async () => {
      mocks.exists!.mockRejectedValue('Unknown error');

      const result = await createBucket({
        bucketName: 'test-bucket',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });
});
