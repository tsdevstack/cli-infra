import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockSend = rs.fn();
rs.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class {
    send = mockSend;
  },
  GetScheduleCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateScheduleCommand: class {
    constructor(public input: unknown) {}
  },
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));

import { pointScheduleAtTaskDefinition } from './point-schedule-at-task-definition';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'k',
  secretAccessKey: 's',
  accountId: '123456789012',
};
const target = {
  Arn: 'arn:aws:ecs:eu-west-1:123456789012:cluster/shop-cluster',
  RoleArn: 'arn:aws:iam::123456789012:role/shop-cron-scheduler',
  RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 },
  EcsParameters: {
    TaskDefinitionArn: 'arn:td/shop-cron-usage-report:1',
    LaunchType: 'FARGATE',
    TaskCount: 1,
    NetworkConfiguration: {
      awsvpcConfiguration: {
        Subnets: ['subnet-a'],
        AssignPublicIp: 'DISABLED',
      },
    },
  },
};

describe('pointScheduleAtTaskDefinition', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should keep the whole schedule and change only the task definition', async () => {
    mockSend
      .mockResolvedValueOnce({
        Name: 'shop-auth-service-usage-report',
        GroupName: 'default',
        ScheduleExpression: 'cron(0 3 * * ? *)',
        ScheduleExpressionTimezone: 'UTC',
        State: 'ENABLED',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: target,
      })
      .mockResolvedValueOnce({});

    await expect(
      pointScheduleAtTaskDefinition({
        credentials,
        scheduleName: 'shop-auth-service-usage-report',
        taskDefinitionArn: 'arn:td/shop-cron-usage-report:7',
      }),
    ).resolves.toBe(true);

    expect(mockSend.mock.calls[0][0].input).toEqual({
      Name: 'shop-auth-service-usage-report',
      GroupName: 'default',
    });
    expect(mockSend.mock.calls[1][0].input).toEqual({
      Name: 'shop-auth-service-usage-report',
      GroupName: 'default',
      ScheduleExpression: 'cron(0 3 * * ? *)',
      ScheduleExpressionTimezone: 'UTC',
      StartDate: undefined,
      EndDate: undefined,
      Description: undefined,
      State: 'ENABLED',
      KmsKeyArn: undefined,
      ActionAfterCompletion: undefined,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        ...target,
        EcsParameters: {
          ...target.EcsParameters,
          TaskDefinitionArn: 'arn:td/shop-cron-usage-report:7',
        },
      },
    });
  });

  it('should answer false for a schedule that does not exist', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'ResourceNotFoundException',
      }),
    );

    await expect(
      pointScheduleAtTaskDefinition({
        credentials,
        scheduleName: 'shop-auth-service-usage-report',
        taskDefinitionArn: 'x',
      }),
    ).resolves.toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should refuse a schedule that starts no ECS task (a trigger's)", async () => {
    mockSend.mockResolvedValueOnce({
      ScheduleExpression: 'cron(0 3 * * ? *)',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: { Arn: 'arn:aws:lambda:...:function:shop-job-invoker' },
    });

    await expect(
      pointScheduleAtTaskDefinition({
        credentials,
        scheduleName: 'shop-auth-service-cleanup',
        taskDefinitionArn: 'x',
      }),
    ).rejects.toThrow(
      'Schedule shop-auth-service-cleanup does not start an ECS task',
    );
  });
});
