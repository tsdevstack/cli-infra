import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockSend = rs.fn();
rs.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class {
    send = mockSend;
  },
  GetScheduleCommand: class {
    constructor(public input: unknown) {}
  },
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));

import { getAwsSchedule } from './get-aws-schedule';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'k',
  secretAccessKey: 's',
  accountId: '123456789012',
};

describe('getAwsSchedule', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should read the schedule from the default group', async () => {
    mockSend.mockResolvedValueOnce({ Name: 'shop-auth-service-cleanup' });

    await expect(
      getAwsSchedule(credentials, 'shop-auth-service-cleanup'),
    ).resolves.toEqual({ Name: 'shop-auth-service-cleanup' });
    expect(mockSend.mock.calls[0][0].input).toEqual({
      Name: 'shop-auth-service-cleanup',
      GroupName: 'default',
    });
  });

  it("should answer undefined for a schedule that doesn't exist", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    );

    await expect(getAwsSchedule(credentials, 'x')).resolves.toBeUndefined();
  });

  it("should pass AWS's other errors on", async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(getAwsSchedule(credentials, 'x')).rejects.toThrow(
      'AccessDenied',
    );
  });
});
