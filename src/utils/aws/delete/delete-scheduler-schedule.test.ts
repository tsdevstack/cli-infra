/**
 * Tests for delete-scheduler-schedule
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteSchedulerSchedule } from './delete-scheduler-schedule';
import { DeleteScheduleCommand } from '@aws-sdk/client-scheduler';

const mockSend = rs.fn();

// Mock AWS SDK
rs.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  DeleteScheduleCommand: rs.fn(),
}));

// Mock buildAWSClientConfig
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

describe('deleteSchedulerSchedule', () => {
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

  it('should delete schedule successfully', async () => {
    mockSend.mockResolvedValue({});

    const result = await deleteSchedulerSchedule({
      scheduleName: 'my-app-auth-service-cleanup-tokens',
      credentials: mockCredentials,
    });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
  });

  it('should handle ResourceNotFoundException as success', async () => {
    const error = new Error('Schedule not found');
    (error as Error & { name: string }).name = 'ResourceNotFoundException';
    mockSend.mockRejectedValue(error);

    const result = await deleteSchedulerSchedule({
      scheduleName: 'my-app-auth-service-cleanup-tokens',
      credentials: mockCredentials,
    });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(false);
  });

  it('should return failure on API error', async () => {
    mockSend.mockRejectedValue(new Error('Access denied'));

    const result = await deleteSchedulerSchedule({
      scheduleName: 'my-app-auth-service-cleanup-tokens',
      credentials: mockCredentials,
    });

    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);
    expect(result.error).toBe('Access denied');
  });

  it('should pass correct parameters to DeleteScheduleCommand', async () => {
    mockSend.mockResolvedValue({});

    await deleteSchedulerSchedule({
      scheduleName: 'my-app-auth-service-cleanup-tokens',
      credentials: mockCredentials,
    });

    expect(DeleteScheduleCommand).toHaveBeenCalledWith({
      Name: 'my-app-auth-service-cleanup-tokens',
      GroupName: 'default',
    });
  });
});
