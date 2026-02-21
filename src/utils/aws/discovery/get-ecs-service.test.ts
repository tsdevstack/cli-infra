import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { getEcsService } from './get-ecs-service';

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  DescribeServicesCommand: rs.fn().mockImplementation(function (params) {
    return { _type: 'DescribeServicesCommand', _params: params };
  }),
}));

// buildAWSClientConfig uses getContext internally
rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: () => false,
  })),
}));

describe('getEcsService', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    clusterName: 'myproject-cluster',
    serviceName: 'auth-service',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('successful retrieval', () => {
    it('should return service details when service exists', async () => {
      mockSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: 'auth-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
            taskDefinition:
              'arn:aws:ecs:us-east-1:123456789012:task-definition/auth-service:5',
            deployments: [{ status: 'PRIMARY', rolloutState: 'COMPLETED' }],
            healthCheckGracePeriodSeconds: 120,
            createdAt: new Date('2024-01-15'),
            events: [
              { message: 'service steady state', createdAt: new Date() },
            ],
          },
        ],
      });

      const result = await getEcsService(baseOptions);
      expect(result.success).toBe(true);
      expect(result.service.exists).toBe(true);
      expect(result.service.serviceName).toBe('auth-service');
      expect(result.service.status).toBe('ACTIVE');
      expect(result.service.runningCount).toBe(1);
      expect(result.service.desiredCount).toBe(1);
      expect(result.service.deploymentStatus).toBe('COMPLETED');
    });

    it('should return not found when service does not exist', async () => {
      mockSend.mockResolvedValueOnce({
        services: [],
      });

      const result = await getEcsService(baseOptions);
      expect(result.success).toBe(true);
      expect(result.service.exists).toBe(false);
      expect(result.service.status).toBe('NOT_FOUND');
    });

    it('should include recent events', async () => {
      const events = [
        { message: 'event 1', createdAt: new Date() },
        { message: 'event 2', createdAt: new Date() },
        { message: 'event 3', createdAt: new Date() },
        { message: 'event 4', createdAt: new Date() },
        { message: 'event 5', createdAt: new Date() },
        { message: 'event 6 - should be excluded', createdAt: new Date() },
      ];

      mockSend.mockResolvedValueOnce({
        services: [
          {
            serviceName: 'auth-service',
            status: 'ACTIVE',
            runningCount: 1,
            desiredCount: 1,
            pendingCount: 0,
            events,
          },
        ],
      });

      const result = await getEcsService(baseOptions);
      expect(result.service.events).toHaveLength(5);
      expect(result.service.events?.[0].message).toBe('event 1');
    });
  });

  describe('error handling', () => {
    it('should return error on API failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Cluster not found'));

      const result = await getEcsService(baseOptions);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cluster not found');
      expect(result.service.exists).toBe(false);
      expect(result.service.status).toBe('ERROR');
    });
  });
});
