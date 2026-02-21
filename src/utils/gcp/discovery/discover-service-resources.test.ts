import { describe, it, expect, rs, beforeEach } from '@rstest/core';

// Mock all individual discovery functions
const mockCloudRunServiceExists = rs.fn();
const mockBucketExists = rs.fn();
const mockListSecretsByPrefix = rs.fn();
const mockDatabaseExists = rs.fn();
const mockServiceAccountExists = rs.fn();

rs.mock('./cloud-run-service-exists', () => ({
  cloudRunServiceExists: (...args: unknown[]) =>
    mockCloudRunServiceExists(...args),
}));

rs.mock('./bucket-exists', () => ({
  bucketExists: (...args: unknown[]) => mockBucketExists(...args),
}));

rs.mock('./list-secrets-by-prefix', () => ({
  listSecretsByPrefix: (...args: unknown[]) => mockListSecretsByPrefix(...args),
}));

rs.mock('./database-exists', () => ({
  databaseExists: (...args: unknown[]) => mockDatabaseExists(...args),
}));

rs.mock('./service-account-exists', () => ({
  serviceAccountExists: (...args: unknown[]) =>
    mockServiceAccountExists(...args),
}));

import { discoverServiceResources } from './discover-service-resources';

describe('discoverServiceResources', () => {
  const baseOptions = {
    serviceName: 'order-service',
    projectName: 'myproject',
    projectId: 'my-gcp-project',
    region: 'us-central1',
    sqlInstanceName: 'myproject-postgres',
    credentials: {
      project_id: 'my-gcp-project',
      region: 'us-central1',
      client_email: 'sa@project.iam.gserviceaccount.com',
      private_key: 'key',
    },
  };

  beforeEach(() => {
    rs.resetAllMocks();
    // Default to "nothing exists"
    mockCloudRunServiceExists.mockResolvedValue({ exists: false });
    mockBucketExists.mockResolvedValue({ exists: false });
    mockListSecretsByPrefix.mockResolvedValue({ success: true, secrets: [] });
    mockDatabaseExists.mockResolvedValue({ exists: false });
    mockServiceAccountExists.mockResolvedValue({ exists: false });
  });

  describe('service type inference', () => {
    it('should infer backend type when Cloud Run service exists', async () => {
      mockCloudRunServiceExists.mockResolvedValue({
        exists: true,
        serviceUrl: 'https://order-service-xxx.run.app',
      });

      const result = await discoverServiceResources(baseOptions);

      expect(result.inferredType).toBe('backend');
      expect(result.cloudRunService).toBe(true);
      expect(result.cloudRunServiceUrl).toBe(
        'https://order-service-xxx.run.app',
      );
    });

    it('should infer spa type when only bucket exists (no Cloud Run)', async () => {
      mockBucketExists.mockResolvedValue({ exists: true });

      const result = await discoverServiceResources(baseOptions);

      expect(result.inferredType).toBe('spa');
      expect(result.spaBucket).toBe(true);
      expect(result.cloudRunService).toBe(false);
    });

    it('should infer backend when both Cloud Run and bucket exist', async () => {
      mockCloudRunServiceExists.mockResolvedValue({ exists: true });
      mockBucketExists.mockResolvedValue({ exists: true });

      const result = await discoverServiceResources(baseOptions);

      // Cloud Run takes precedence
      expect(result.inferredType).toBe('backend');
    });

    it('should return unknown when no resources exist', async () => {
      const result = await discoverServiceResources(baseOptions);

      expect(result.inferredType).toBe('unknown');
    });
  });

  describe('resource detection', () => {
    it('should detect database and set hasDatabase flag', async () => {
      mockDatabaseExists.mockResolvedValue({ exists: true });

      const result = await discoverServiceResources(baseOptions);

      expect(result.database).toBe(true);
      expect(result.hasDatabase).toBe(true);
      expect(result.databaseUser).toBe(true); // Assumed when database exists
    });

    it('should detect secrets and return names', async () => {
      mockListSecretsByPrefix.mockResolvedValue({
        success: true,
        secrets: [
          {
            name: 'myproject-order-service-API-KEY',
            fullName: 'projects/x/secrets/y',
          },
          {
            name: 'myproject-order-service-DB-PASSWORD',
            fullName: 'projects/x/secrets/z',
          },
        ],
      });

      const result = await discoverServiceResources(baseOptions);

      expect(result.secrets).toHaveLength(2);
      expect(result.secrets).toContain('myproject-order-service-API-KEY');
    });

    it('should detect service account', async () => {
      mockServiceAccountExists.mockResolvedValue({ exists: true });

      const result = await discoverServiceResources(baseOptions);

      expect(result.serviceAccount).toBe(true);
      expect(result.serviceAccountEmail).toBe(
        'myproject-order-service-rt@my-gcp-project.iam.gserviceaccount.com',
      );
    });

    it('should build correct bucket name', async () => {
      const result = await discoverServiceResources(baseOptions);

      expect(result.spaBucketName).toBe('myproject-order-service-spa');
    });
  });

  describe('discovery calls', () => {
    it('should call all discovery functions with correct options', async () => {
      await discoverServiceResources(baseOptions);

      expect(mockCloudRunServiceExists).toHaveBeenCalledWith({
        serviceName: 'order-service',
        projectId: 'my-gcp-project',
        region: 'us-central1',
        credentials: baseOptions.credentials,
      });

      expect(mockBucketExists).toHaveBeenCalledWith({
        bucketName: 'myproject-order-service-spa',
        credentials: baseOptions.credentials,
      });

      expect(mockListSecretsByPrefix).toHaveBeenCalledWith({
        projectId: 'my-gcp-project',
        prefix: 'myproject-order-service-',
        credentials: baseOptions.credentials,
      });

      expect(mockDatabaseExists).toHaveBeenCalledWith({
        databaseName: 'order-service',
        instanceName: 'myproject-postgres',
        projectId: 'my-gcp-project',
        credentials: baseOptions.credentials,
      });

      expect(mockServiceAccountExists).toHaveBeenCalledWith({
        serviceAccountEmail:
          'myproject-order-service-rt@my-gcp-project.iam.gserviceaccount.com',
        projectId: 'my-gcp-project',
        credentials: baseOptions.credentials,
      });
    });

    it('should run all discovery calls in parallel', async () => {
      // All mocks return after different delays
      const callOrder: string[] = [];
      mockCloudRunServiceExists.mockImplementation(async () => {
        callOrder.push('cloudrun-start');
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push('cloudrun-end');
        return { exists: false };
      });
      mockBucketExists.mockImplementation(async () => {
        callOrder.push('bucket-start');
        await new Promise((r) => setTimeout(r, 5));
        callOrder.push('bucket-end');
        return { exists: false };
      });

      await discoverServiceResources(baseOptions);

      // Both should start before either ends (parallel execution)
      expect(callOrder.indexOf('bucket-start')).toBeLessThan(
        callOrder.indexOf('cloudrun-end'),
      );
    });
  });

  describe('error handling', () => {
    it('should return empty secrets array when secrets call fails', async () => {
      mockListSecretsByPrefix.mockResolvedValue({
        success: false,
        secrets: [],
        error: 'Permission denied',
      });

      const result = await discoverServiceResources(baseOptions);

      expect(result.secrets).toEqual([]);
    });
  });

  describe('full backend service discovery', () => {
    it('should detect all resources for a fully deployed backend service', async () => {
      mockCloudRunServiceExists.mockResolvedValue({
        exists: true,
        serviceUrl: 'https://order-service.run.app',
      });
      mockDatabaseExists.mockResolvedValue({ exists: true });
      mockListSecretsByPrefix.mockResolvedValue({
        success: true,
        secrets: [
          { name: 'myproject-order-service-DB-PASSWORD', fullName: 'x' },
        ],
      });
      mockServiceAccountExists.mockResolvedValue({ exists: true });

      const result = await discoverServiceResources(baseOptions);

      expect(result.inferredType).toBe('backend');
      expect(result.cloudRunService).toBe(true);
      expect(result.database).toBe(true);
      expect(result.hasDatabase).toBe(true);
      expect(result.secrets).toHaveLength(1);
      expect(result.serviceAccount).toBe(true);
      expect(result.spaBucket).toBe(false);
    });
  });

  describe('full spa service discovery', () => {
    it('should detect all resources for a fully deployed spa service', async () => {
      mockBucketExists.mockResolvedValue({ exists: true });
      // SPA services typically don't have service accounts or databases

      const result = await discoverServiceResources(baseOptions);

      expect(result.inferredType).toBe('spa');
      expect(result.spaBucket).toBe(true);
      expect(result.cloudRunService).toBe(false);
      expect(result.database).toBe(false);
      expect(result.serviceAccount).toBe(false);
    });
  });
});
