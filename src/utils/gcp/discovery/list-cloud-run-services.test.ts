import { describe, it, expect, rs, beforeEach } from '@rstest/core';

// Use rs.hoisted to create mocks that will be hoisted along with rs.mock
const mocks = rs.hoisted(() => {
  return {
    listServicesAsync: rs.fn(),
  };
});

rs.mock('@google-cloud/run', () => {
  return {
    ServicesClient: class MockServicesClient {
      listServicesAsync(...args: unknown[]) {
        return mocks.listServicesAsync(...args);
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

import { listCloudRunServices } from './list-cloud-run-services';

describe('listCloudRunServices', () => {
  const baseOptions = {
    projectId: 'my-gcp-project',
    region: 'us-central1',
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

  // Helper to create async iterable from array
  async function* createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe('listing services', () => {
    it('should return empty array when no services exist', async () => {
      mocks.listServicesAsync.mockReturnValue(createAsyncIterable([]));

      const result = await listCloudRunServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toEqual([]);
    });

    it('should return all services in region', async () => {
      mocks.listServicesAsync.mockReturnValue(
        createAsyncIterable([
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/auth-service',
            uri: 'https://auth-service-xxx.run.app',
          },
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/bff-service',
            uri: 'https://bff-service-xxx.run.app',
          },
        ]),
      );

      const result = await listCloudRunServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(2);
      expect(result.services[0]).toEqual({
        name: 'auth-service',
        fullName:
          'projects/my-gcp-project/locations/us-central1/services/auth-service',
        url: 'https://auth-service-xxx.run.app',
        serviceAccount: undefined,
        imageUri: undefined,
        status: 'UNKNOWN',
      });
      expect(result.services[1]).toEqual({
        name: 'bff-service',
        fullName:
          'projects/my-gcp-project/locations/us-central1/services/bff-service',
        url: 'https://bff-service-xxx.run.app',
        serviceAccount: undefined,
        imageUri: undefined,
        status: 'UNKNOWN',
      });
    });

    it('should handle services without URI', async () => {
      mocks.listServicesAsync.mockReturnValue(
        createAsyncIterable([
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/auth-service',
            uri: null,
          },
        ]),
      );

      const result = await listCloudRunServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services[0].url).toBeUndefined();
    });
  });

  describe('prefix filtering', () => {
    it('should filter services by prefix when specified', async () => {
      mocks.listServicesAsync.mockReturnValue(
        createAsyncIterable([
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/myproject-auth-service',
            uri: 'https://myproject-auth-service-xxx.run.app',
          },
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/other-service',
            uri: 'https://other-service-xxx.run.app',
          },
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/myproject-kong',
            uri: 'https://myproject-kong-xxx.run.app',
          },
        ]),
      );

      const result = await listCloudRunServices({
        ...baseOptions,
        prefix: 'myproject-',
      });

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(2);
      expect(result.services.map((s) => s.name)).toEqual([
        'myproject-auth-service',
        'myproject-kong',
      ]);
    });

    it('should return all services when prefix is not specified', async () => {
      mocks.listServicesAsync.mockReturnValue(
        createAsyncIterable([
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/auth-service',
            uri: 'https://auth-service-xxx.run.app',
          },
          {
            name: 'projects/my-gcp-project/locations/us-central1/services/other-service',
            uri: 'https://other-service-xxx.run.app',
          },
        ]),
      );

      const result = await listCloudRunServices(baseOptions);

      expect(result.services).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should return error result on API failure', async () => {
      mocks.listServicesAsync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await listCloudRunServices(baseOptions);

      expect(result.success).toBe(false);
      expect(result.services).toEqual([]);
      expect(result.error).toBe('Permission denied');
    });

    it('should handle non-Error exceptions', async () => {
      mocks.listServicesAsync.mockImplementation(() => {
        throw 'Unknown error';
      });

      const result = await listCloudRunServices(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('API call parameters', () => {
    it('should call listServicesAsync with correct parent and options', async () => {
      mocks.listServicesAsync.mockReturnValue(createAsyncIterable([]));

      await listCloudRunServices(baseOptions);

      expect(mocks.listServicesAsync).toHaveBeenCalledWith(
        { parent: 'projects/my-gcp-project/locations/us-central1' },
        { autoPaginate: false },
      );
    });
  });
});
