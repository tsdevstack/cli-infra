/**
 * Tests for delete-ecs-service
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteEcsService } from './delete-ecs-service';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  DescribeServicesCommand: rs.fn(),
  UpdateServiceCommand: rs.fn(),
  DeleteServiceCommand: rs.fn(),
}));

// Mock context
rs.mock('../../../context', () => ({
  getContext: rs.fn(() => ({
    isCIEnv: rs.fn(() => false),
  })),
}));

describe('deleteEcsService', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    accountId: '123456789012',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
  });

  describe('Standard use cases', () => {
    it('should return success false on error', async () => {
      mockSend.mockRejectedValue(new Error('API error'));

      const result = await deleteEcsService({
        credentials: mockCredentials,
        clusterName: 'test-cluster',
        serviceName: 'test-service',
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle ServiceNotFoundException as success', async () => {
      const error = new Error('Service not found');
      (error as Error & { name: string }).name = 'ServiceNotFoundException';
      mockSend.mockRejectedValue(error);

      const result = await deleteEcsService({
        credentials: mockCredentials,
        clusterName: 'test-cluster',
        serviceName: 'test-service',
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
    });
  });
});
