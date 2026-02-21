/**
 * Tests for delete-cloudwatch-log-group
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteCloudWatchLogGroup } from './delete-cloudwatch-log-group';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  DeleteLogGroupCommand: rs.fn(),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ResourceNotFoundException';
    }
  },
}));

// Mock buildAWSClientConfig
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

describe('deleteCloudWatchLogGroup', () => {
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
    it('should return success false on API error', async () => {
      mockSend.mockRejectedValue(new Error('API error'));

      const result = await deleteCloudWatchLogGroup({
        logGroupName: '/aws/ecs/test-service',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle ResourceNotFoundException as success', async () => {
      const error = new Error('Resource not found');
      (error as Error & { name: string }).name = 'ResourceNotFoundException';
      mockSend.mockRejectedValue(error);

      const result = await deleteCloudWatchLogGroup({
        logGroupName: '/aws/ecs/test-service',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
    });

    it('should return success true when log group deleted', async () => {
      mockSend.mockResolvedValue({});

      const result = await deleteCloudWatchLogGroup({
        logGroupName: '/aws/ecs/test-service',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
    });
  });
});
