/**
 * Tests for delete-apprunner-service
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteAppRunnerService } from './delete-apprunner-service';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-apprunner', () => ({
  AppRunnerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListServicesCommand: rs.fn(),
  DeleteServiceCommand: rs.fn(),
}));

// Mock buildAWSClientConfig
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

describe('deleteAppRunnerService', () => {
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

      const result = await deleteAppRunnerService({
        projectName: 'test-project',
        targetEnv: 'dev',
        serviceName: 'test-service',
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

      const result = await deleteAppRunnerService({
        projectName: 'test-project',
        targetEnv: 'dev',
        serviceName: 'test-service',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
    });

    it('should return deleted false when service not found', async () => {
      mockSend.mockResolvedValue({ ServiceSummaryList: [] });

      const result = await deleteAppRunnerService({
        projectName: 'test-project',
        targetEnv: 'dev',
        serviceName: 'test-service',
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(false);
    });
  });
});
