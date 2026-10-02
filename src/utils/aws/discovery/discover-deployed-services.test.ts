import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { discoverDeployedServices } from './discover-deployed-services';
import * as listEcsModule from './list-ecs-services';
import * as listSpaBucketsModule from './list-spa-buckets';

rs.mock('./list-ecs-services', { mock: true });
rs.mock('./list-spa-buckets', { mock: true });

describe('discoverDeployedServices', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    projectName: 'myproject',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('successful discovery', () => {
    it('should return empty array when no services exist', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: true,
        services: [],
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: true,
        buckets: [],
      });

      const result = await discoverDeployedServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toEqual([]);
    });

    it('should combine ECS and SPA services', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: true,
        services: [
          {
            name: 'myproject-auth-service',
            serviceName: 'auth-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
          {
            name: 'myproject-frontend',
            serviceName: 'frontend',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
        ],
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: true,
        buckets: [{ name: 'myproject-admin-spa', serviceName: 'admin' }],
      });

      const result = await discoverDeployedServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(3);
    });

    it('should identify service types correctly', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: true,
        services: [
          {
            name: 'myproject-auth-service',
            serviceName: 'auth-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
          {
            name: 'myproject-kong',
            serviceName: 'kong',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
          {
            name: 'myproject-offers-worker',
            serviceName: 'offers-worker',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
        ],
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: true,
        buckets: [{ name: 'myproject-admin-spa', serviceName: 'admin' }],
      });

      const result = await discoverDeployedServices(baseOptions);
      expect(result.success).toBe(true);

      const authService = result.services.find(
        (s) => s.name === 'auth-service',
      );
      expect(authService?.type).toBe('backend');

      const kong = result.services.find((s) => s.name === 'kong');
      expect(kong?.type).toBe('kong');

      const worker = result.services.find((s) => s.name === 'offers-worker');
      expect(worker?.type).toBe('worker');

      const admin = result.services.find((s) => s.name === 'admin');
      expect(admin?.type).toBe('spa');
    });

    it('should sort services by name', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: true,
        services: [
          {
            name: 'myproject-zeta',
            serviceName: 'zeta',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
          {
            name: 'myproject-alpha',
            serviceName: 'alpha',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
        ],
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: true,
        buckets: [],
      });

      const result = await discoverDeployedServices(baseOptions);
      expect(result.services[0].name).toBe('alpha');
      expect(result.services[1].name).toBe('zeta');
    });
  });

  describe('partial failures', () => {
    it('should continue if one service type fails', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: true,
        services: [
          {
            name: 'myproject-auth-service',
            serviceName: 'auth-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
        ],
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: false,
        buckets: [],
        error: 'S3 access denied',
      });

      const result = await discoverDeployedServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(1);
    });

    it('should fail if all service types fail', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: false,
        services: [],
        error: 'ECS error',
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: false,
        buckets: [],
        error: 'S3 error',
      });

      const result = await discoverDeployedServices(baseOptions);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ECS');
      expect(result.error).toContain('S3');
    });
  });

  describe('resource tracking', () => {
    it('should correctly set resource flags for ECS services', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: true,
        services: [
          {
            name: 'myproject-auth-service',
            serviceName: 'auth-service',
            status: 'ACTIVE',
            runningCount: 2,
            desiredCount: 2,
            pendingCount: 0,
          },
        ],
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: true,
        buckets: [],
      });

      const result = await discoverDeployedServices(baseOptions);
      const service = result.services[0];
      expect(service.resources.ecsService).toBe(true);
      expect(service.resources.spaBucket).toBe(false);
      expect(service.resources.runningCount).toBe(2);
      expect(service.resources.desiredCount).toBe(2);
    });

    it('should correctly set resource flags for SPA services', async () => {
      rs.mocked(listEcsModule.listEcsServices).mockResolvedValueOnce({
        success: true,
        services: [],
      });
      rs.mocked(listSpaBucketsModule.listSpaBuckets).mockResolvedValueOnce({
        success: true,
        buckets: [{ name: 'myproject-admin-spa', serviceName: 'admin' }],
      });

      const result = await discoverDeployedServices(baseOptions);
      const service = result.services[0];
      expect(service.resources.ecsService).toBe(false);
      expect(service.resources.spaBucket).toBe(true);
      expect(service.status).toBe('DEPLOYED');
    });
  });
});
