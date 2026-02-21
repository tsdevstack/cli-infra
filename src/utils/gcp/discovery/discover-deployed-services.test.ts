import { describe, it, expect, rs, beforeEach } from '@rstest/core';

// Mock dependencies
const mockListCloudRunServices = rs.fn();
const mockListSpaBuckets = rs.fn();
const mockDiscoverServiceResources = rs.fn();

rs.mock('./list-cloud-run-services', () => ({
  listCloudRunServices: (...args: unknown[]) =>
    mockListCloudRunServices(...args),
}));

rs.mock('./list-spa-buckets', () => ({
  listSpaBuckets: (...args: unknown[]) => mockListSpaBuckets(...args),
}));

rs.mock('./discover-service-resources', () => ({
  discoverServiceResources: (...args: unknown[]) =>
    mockDiscoverServiceResources(...args),
}));

import { discoverDeployedServices } from './discover-deployed-services';

describe('discoverDeployedServices', () => {
  const baseOptions = {
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

  const createDiscoveredResources = (overrides = {}) => ({
    cloudRunService: false,
    spaBucket: false,
    database: false,
    databaseUser: false,
    secrets: [],
    serviceAccount: false,
    inferredType: 'unknown' as const,
    hasDatabase: false,
    spaBucketName: '',
    serviceAccountEmail: '',
    ...overrides,
  });

  beforeEach(() => {
    rs.resetAllMocks();
    // Default to empty results
    mockListCloudRunServices.mockResolvedValue({ success: true, services: [] });
    mockListSpaBuckets.mockResolvedValue({ success: true, buckets: [] });
    mockDiscoverServiceResources.mockResolvedValue(createDiscoveredResources());
  });

  describe('service discovery', () => {
    it('should return empty array when no services exist', async () => {
      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toEqual([]);
    });

    it('should discover Cloud Run services', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            fullName: 'projects/.../auth-service',
            url: 'https://auth.run.app',
          },
        ],
      });
      mockDiscoverServiceResources.mockResolvedValue(
        createDiscoveredResources({
          cloudRunService: true,
          inferredType: 'backend',
          secrets: ['secret1'],
          serviceAccount: true,
        }),
      );

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(1);
      expect(result.services[0]).toMatchObject({
        name: 'auth-service',
        type: 'backend',
        url: 'https://auth.run.app',
        resources: {
          cloudRunService: true,
          spaBucket: false,
          secretCount: 1,
          hasServiceAccount: true,
        },
      });
    });

    it('should discover SPA buckets', async () => {
      mockListSpaBuckets.mockResolvedValue({
        success: true,
        buckets: [
          {
            serviceName: 'landing-page',
            bucketName: 'myproject-landing-page-spa',
          },
        ],
      });
      mockDiscoverServiceResources.mockResolvedValue(
        createDiscoveredResources({
          spaBucket: true,
          inferredType: 'spa',
          spaBucketName: 'myproject-landing-page-spa',
        }),
      );

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(1);
      expect(result.services[0]).toMatchObject({
        name: 'landing-page',
        type: 'spa',
        resources: {
          cloudRunService: false,
          spaBucket: true,
        },
      });
    });

    it('should combine Cloud Run and SPA services', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          { name: 'auth-service', fullName: 'x', url: 'https://auth.run.app' },
          { name: 'bff-service', fullName: 'x', url: 'https://bff.run.app' },
        ],
      });
      mockListSpaBuckets.mockResolvedValue({
        success: true,
        buckets: [
          {
            serviceName: 'landing-page',
            bucketName: 'myproject-landing-page-spa',
          },
        ],
      });
      mockDiscoverServiceResources.mockImplementation(
        async (opts: { serviceName: string }) => {
          if (opts.serviceName === 'landing-page') {
            return createDiscoveredResources({
              spaBucket: true,
              inferredType: 'spa',
            });
          }
          return createDiscoveredResources({
            cloudRunService: true,
            inferredType: 'backend',
          });
        },
      );

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services).toHaveLength(3);
      expect(result.services.map((s) => s.name)).toEqual([
        'auth-service',
        'bff-service',
        'landing-page',
      ]);
    });

    it('should deduplicate services found in both Cloud Run and buckets', async () => {
      // Rare case where same service name appears as both
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'dashboard',
            fullName: 'x',
            url: 'https://dashboard.run.app',
          },
        ],
      });
      mockListSpaBuckets.mockResolvedValue({
        success: true,
        buckets: [
          { serviceName: 'dashboard', bucketName: 'myproject-dashboard-spa' },
        ],
      });

      const result = await discoverDeployedServices(baseOptions);

      // Should only appear once
      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('dashboard');
    });
  });

  describe('Kong gateway filtering', () => {
    it('should exclude Kong gateway from results', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'myproject-kong',
            fullName: 'x',
            url: 'https://kong.run.app',
          },
          { name: 'auth-service', fullName: 'x', url: 'https://auth.run.app' },
        ],
      });
      mockDiscoverServiceResources.mockResolvedValue(
        createDiscoveredResources({
          cloudRunService: true,
          inferredType: 'backend',
        }),
      );

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('auth-service');
    });
  });

  describe('error handling', () => {
    it('should return error when Cloud Run listing fails', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: false,
        services: [],
        error: 'Permission denied',
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cloud Run services');
      expect(result.error).toContain('Permission denied');
    });

    it('should return error when SPA buckets listing fails', async () => {
      mockListSpaBuckets.mockResolvedValue({
        success: false,
        buckets: [],
        error: 'Storage API error',
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('SPA buckets');
      expect(result.error).toContain('Storage API error');
    });
  });

  describe('sorting', () => {
    it('should sort services alphabetically by name', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          { name: 'zeta-service', fullName: 'x', url: 'x' },
          { name: 'alpha-service', fullName: 'x', url: 'x' },
          { name: 'beta-service', fullName: 'x', url: 'x' },
        ],
      });
      mockDiscoverServiceResources.mockResolvedValue(
        createDiscoveredResources(),
      );

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services.map((s) => s.name)).toEqual([
        'alpha-service',
        'beta-service',
        'zeta-service',
      ]);
    });
  });

  describe('parallel execution', () => {
    it('should call list functions in parallel', async () => {
      const callOrder: string[] = [];

      mockListCloudRunServices.mockImplementation(async () => {
        callOrder.push('cloudrun-start');
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push('cloudrun-end');
        return { success: true, services: [] };
      });

      mockListSpaBuckets.mockImplementation(async () => {
        callOrder.push('spa-start');
        await new Promise((r) => setTimeout(r, 5));
        callOrder.push('spa-end');
        return { success: true, buckets: [] };
      });

      await discoverDeployedServices(baseOptions);

      // Both should start before either ends
      expect(callOrder.indexOf('spa-start')).toBeLessThan(
        callOrder.indexOf('cloudrun-end'),
      );
    });

    it('should get service details in parallel', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          { name: 'service-a', fullName: 'x', url: 'x' },
          { name: 'service-b', fullName: 'x', url: 'x' },
        ],
      });

      const callOrder: string[] = [];
      mockDiscoverServiceResources.mockImplementation(
        async (opts: { serviceName: string }) => {
          callOrder.push(`${opts.serviceName}-start`);
          await new Promise((r) => setTimeout(r, 5));
          callOrder.push(`${opts.serviceName}-end`);
          return createDiscoveredResources();
        },
      );

      await discoverDeployedServices(baseOptions);

      // Both should start before either ends (parallel)
      expect(callOrder.indexOf('service-b-start')).toBeLessThan(
        callOrder.indexOf('service-a-end'),
      );
    });
  });

  describe('resource details', () => {
    it('should include correct resource counts', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          { name: 'auth-service', fullName: 'x', url: 'https://auth.run.app' },
        ],
      });
      mockDiscoverServiceResources.mockResolvedValue(
        createDiscoveredResources({
          cloudRunService: true,
          database: true,
          hasDatabase: true,
          secrets: ['secret1', 'secret2', 'secret3'],
          serviceAccount: true,
          inferredType: 'backend',
        }),
      );

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services[0].resources).toEqual({
        cloudRunService: true,
        spaBucket: false,
        hasDatabase: true,
        secretCount: 3,
        hasServiceAccount: true,
      });
    });
  });
});
