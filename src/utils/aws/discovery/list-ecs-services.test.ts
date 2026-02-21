import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { listEcsServices } from './list-ecs-services';

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListServicesCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'ListServicesCommand', _params: params };
  }),
  DescribeServicesCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'DescribeServicesCommand', _params: params };
  }),
}));

rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
  })),
}));

describe('listEcsServices', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    clusterName: 'myproject-cluster',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('successful listing', () => {
    it('should return empty array when no services exist', async () => {
      mockSend.mockResolvedValueOnce({
        serviceArns: [],
      });

      const result = await listEcsServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toEqual([]);
    });

    it('should list services with details', async () => {
      mockSend.mockResolvedValueOnce({
        serviceArns: [
          'arn:aws:ecs:us-east-1:123456789012:service/myproject-cluster/myproject-auth-service',
          'arn:aws:ecs:us-east-1:123456789012:service/myproject-cluster/myproject-kong',
        ],
      });
      mockSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: 'myproject-auth-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
          {
            serviceName: 'myproject-kong',
            status: 'ACTIVE',
            runningCount: 2,
            desiredCount: 2,
            pendingCount: 0,
          },
        ],
      });

      const result = await listEcsServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(2);
      expect(result.services[0]).toEqual({
        name: 'myproject-auth-service',
        serviceName: 'auth-service',
        status: 'ACTIVE',
        runningCount: 1,
        desiredCount: 1,
        pendingCount: 0,
      });
      expect(result.services[1]).toEqual({
        name: 'myproject-kong',
        serviceName: 'kong',
        status: 'ACTIVE',
        runningCount: 2,
        desiredCount: 2,
        pendingCount: 0,
      });
    });

    it('should handle services with pending tasks', async () => {
      mockSend.mockResolvedValueOnce({
        serviceArns: [
          'arn:aws:ecs:us-east-1:123456789012:service/myproject-cluster/myproject-bff-service',
        ],
      });
      mockSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: 'myproject-bff-service',
            status: 'ACTIVE',
            runningCount: 0,
            desiredCount: 1,
            pendingCount: 1,
          },
        ],
      });

      const result = await listEcsServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services[0].runningCount).toBe(0);
      expect(result.services[0].pendingCount).toBe(1);
    });
  });

  describe('service name extraction', () => {
    it('should extract service name from full name with project prefix', async () => {
      mockSend.mockResolvedValueOnce({
        serviceArns: ['arn:aws:ecs:...'],
      });
      mockSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: 'myproject-offers-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
        ],
      });

      const result = await listEcsServices(baseOptions);
      expect(result.services[0].name).toBe('myproject-offers-service');
      expect(result.services[0].serviceName).toBe('offers-service');
    });

    it('should keep service name as-is if no project prefix', async () => {
      mockSend.mockResolvedValueOnce({
        serviceArns: ['arn:aws:ecs:...'],
      });
      mockSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: 'standalone-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
          },
        ],
      });

      const result = await listEcsServices(baseOptions);
      expect(result.services[0].serviceName).toBe('standalone-service');
    });
  });

  describe('error handling', () => {
    it('should return error on API failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      const result = await listEcsServices(baseOptions);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access Denied');
      expect(result.services).toEqual([]);
    });

    it('should handle undefined fields gracefully', async () => {
      mockSend.mockResolvedValueOnce({
        serviceArns: ['arn:aws:ecs:...'],
      });
      mockSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: undefined,
            status: undefined,
            runningCount: undefined,
            desiredCount: undefined,
            pendingCount: undefined,
          },
        ],
      });

      const result = await listEcsServices(baseOptions);
      expect(result.success).toBe(true);
      expect(result.services[0]).toEqual({
        name: '',
        serviceName: '',
        status: 'UNKNOWN',
        runningCount: 0,
        desiredCount: 0,
        pendingCount: 0,
      });
    });
  });
});
