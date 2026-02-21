import { describe, it, expect, rs, beforeEach } from '@rstest/core';

// Use rs.hoisted to create mocks that will be hoisted along with rs.mock
const mocks = rs.hoisted(() => {
  return {
    getBuckets: rs.fn(),
  };
});

rs.mock('@google-cloud/storage', () => {
  return {
    Storage: class MockStorage {
      getBuckets() {
        return mocks.getBuckets();
      }
    },
  };
});

// Mock context
rs.mock('../../../context', () => ({
  getContext: () => ({
    buildGCPClientOptions: () => ({}),
  }),
}));

import { listSpaBuckets } from './list-spa-buckets';

describe('listSpaBuckets', () => {
  const baseOptions = {
    projectName: 'myproject',
    projectId: 'my-gcp-project',
    credentials: {
      project_id: 'my-gcp-project',
      region: 'us-central1',
      client_email: 'sa@project.iam.gserviceaccount.com',
      private_key: 'key',
    },
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  // Helper to create bucket mock objects
  const createBucket = (name: string) => ({ name });

  describe('listing buckets', () => {
    it('should return empty array when no buckets exist', async () => {
      mocks.getBuckets.mockResolvedValue([[]]);

      const result = await listSpaBuckets(baseOptions);

      expect(result.success).toBe(true);
      expect(result.buckets).toEqual([]);
    });

    it('should find SPA buckets matching pattern', async () => {
      mocks.getBuckets.mockResolvedValue([
        [
          createBucket('myproject-landing-page-spa'),
          createBucket('myproject-dashboard-spa'),
          createBucket('other-bucket'),
        ],
      ]);

      const result = await listSpaBuckets(baseOptions);

      expect(result.success).toBe(true);
      expect(result.buckets).toHaveLength(2);
      expect(result.buckets).toContainEqual({
        serviceName: 'landing-page',
        bucketName: 'myproject-landing-page-spa',
      });
      expect(result.buckets).toContainEqual({
        serviceName: 'dashboard',
        bucketName: 'myproject-dashboard-spa',
      });
    });

    it('should extract service name correctly', async () => {
      mocks.getBuckets.mockResolvedValue([
        [createBucket('myproject-my-cool-app-spa')],
      ]);

      const result = await listSpaBuckets(baseOptions);

      expect(result.buckets[0].serviceName).toBe('my-cool-app');
    });
  });

  describe('filtering', () => {
    it('should skip buckets without project prefix', async () => {
      mocks.getBuckets.mockResolvedValue([
        [
          createBucket('otherproject-landing-spa'),
          createBucket('myproject-landing-spa'),
        ],
      ]);

      const result = await listSpaBuckets(baseOptions);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].bucketName).toBe('myproject-landing-spa');
    });

    it('should skip buckets without -spa suffix', async () => {
      mocks.getBuckets.mockResolvedValue([
        [
          createBucket('myproject-assets'),
          createBucket('myproject-backups'),
          createBucket('myproject-app-spa'),
        ],
      ]);

      const result = await listSpaBuckets(baseOptions);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].bucketName).toBe('myproject-app-spa');
    });

    it('should skip malformed bucket names', async () => {
      mocks.getBuckets.mockResolvedValue([
        [
          createBucket('myproject--spa'), // Empty service name
          createBucket('myproject-valid-spa'),
        ],
      ]);

      const result = await listSpaBuckets(baseOptions);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].serviceName).toBe('valid');
    });

    it('should not match bucket named exactly prefix+suffix', async () => {
      mocks.getBuckets.mockResolvedValue([[createBucket('myproject-spa')]]);

      const result = await listSpaBuckets(baseOptions);

      // "myproject-spa" doesn't have a service name in the middle
      expect(result.buckets).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should return error result on API failure', async () => {
      mocks.getBuckets.mockRejectedValue(new Error('Permission denied'));

      const result = await listSpaBuckets(baseOptions);

      expect(result.success).toBe(false);
      expect(result.buckets).toEqual([]);
      expect(result.error).toBe('Permission denied');
    });

    it('should handle non-Error exceptions', async () => {
      mocks.getBuckets.mockRejectedValue('Unknown error');

      const result = await listSpaBuckets(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('edge cases', () => {
    it('should handle service names with multiple hyphens', async () => {
      mocks.getBuckets.mockResolvedValue([
        [createBucket('myproject-my-long-service-name-spa')],
      ]);

      const result = await listSpaBuckets(baseOptions);

      expect(result.buckets[0].serviceName).toBe('my-long-service-name');
    });

    it('should work with different project names', async () => {
      mocks.getBuckets.mockResolvedValue([
        [createBucket('tsdevstack-app-spa'), createBucket('myproject-app-spa')],
      ]);

      const result = await listSpaBuckets({
        ...baseOptions,
        projectName: 'tsdevstack',
      });

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0].bucketName).toBe('tsdevstack-app-spa');
    });
  });
});
