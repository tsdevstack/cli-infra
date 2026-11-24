import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockSchedulerSend = rs.fn();
rs.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class {
    send = mockSchedulerSend;
  },
  GetScheduleCommand: class {
    constructor(public input: unknown) {}
  },
}));

const mockRunAndWait = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  runEcsTaskAndWait: (...args: unknown[]) => mockRunAndWait(...args),
  isCronJob: (job: { type?: string }) => job.type === 'cron',
  CRON_JOB_TIMEOUT: { aws: { min: 1, max: 86400, default: 600 } },
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS: 60,
  CRON_JOB_NAME_PREFIX: 'cron-',
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
const mockPrintFailedRunLines = rs.fn();
rs.mock('../../logs/print-failed-run-lines', () => ({
  printFailedRunLines: (...args: unknown[]) => mockPrintFailedRunLines(...args),
}));
rs.mock('../logs/aws-logs-reader', () => ({
  AwsLogsReader: class {
    constructor(public params: unknown) {}
  },
}));
const mockRunTriggerNow = rs.fn();
rs.mock('./run-aws-trigger-now', () => ({
  runAwsTriggerNow: (...args: unknown[]) => mockRunTriggerNow(...args),
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));
const mockLoadInfrastructureConfig = rs.fn();
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));

import { awsRunCron } from './run-cron';

const ctx = {
  projectRoot: '/project',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    region: 'eu-west-1',
    accessKeyId: 'k',
    secretAccessKey: 's',
    accountId: '123456789012',
  },
  runningInCI: false,
};
const schedule = {
  Target: {
    Arn: 'arn:aws:ecs:eu-west-1:123456789012:cluster/shop-cluster',
    EcsParameters: {
      TaskDefinitionArn:
        'arn:aws:ecs:eu-west-1:123456789012:task-definition/shop-cron-usage-report:7',
      NetworkConfiguration: {
        awsvpcConfiguration: {
          Subnets: ['subnet-a', 'subnet-b'],
          SecurityGroups: ['sg-1'],
          AssignPublicIp: 'DISABLED',
        },
      },
    },
  },
};

describe('awsRunCron', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    process.exitCode = undefined;
    mockLoadInfrastructureConfig.mockReturnValue({
      version: '1.0.0',
      dev: {
        scheduledJobs: [
          {
            name: 'cleanup-tokens',
            schedule: '0 3 * * *',
            targetService: 'auth-service',
            endpoint: '/auth/jobs/cleanup-tokens',
          },
          {
            name: 'usage-report',
            type: 'cron',
            schedule: '0 3 * * *',
            targetService: 'auth-service',
            timeout: 1800,
          },
        ],
      },
    });
    mockSchedulerSend.mockResolvedValue(schedule);
    mockRunAndWait.mockResolvedValue({
      success: true,
      taskArn: 't',
      exitCode: 0,
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('should run one task as the schedule would and wait its timeout plus the margin', async () => {
    await awsRunCron(ctx, { job: 'usage-report' });

    expect(mockSchedulerSend.mock.calls[0][0].input).toEqual({
      Name: 'shop-auth-service-usage-report',
      GroupName: 'default',
    });
    expect(mockRunAndWait).toHaveBeenCalledWith(
      {},
      {
        credentials: ctx.credentials,
        cluster: schedule.Target.Arn,
        taskDefinitionArn: schedule.Target.EcsParameters.TaskDefinitionArn,
        subnets: ['subnet-a', 'subnet-b'],
        securityGroups: ['sg-1'],
        assignPublicIp: false,
        containerName: 'cron-usage-report',
        timeoutSeconds: 1860,
        startedBy: 'tsdevstack-run-cron',
      },
    );
    expect(mocks.logger.success).toHaveBeenCalledWith(
      '"usage-report" finished: Succeeded',
    );
    expect(mockPrintFailedRunLines).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('should report a failed run with its exit code, reason and its lines as infra:logs prints them', async () => {
    mockRunAndWait.mockResolvedValue({
      success: false,
      taskArn: 't',
      exitCode: 1,
      reason: 'Essential container in task exited',
    });
    const before = Date.now();

    await awsRunCron(ctx, { job: 'usage-report' });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"usage-report" failed (exit code 1): Essential container in task exited',
    );
    const [params] = mockPrintFailedRunLines.mock.calls[0] as [
      {
        createReader: () => { params: unknown };
        source: unknown;
        startedAt: Date;
      },
    ];
    expect(params.source).toEqual({
      name: 'usage-report',
      type: 'cron',
      service: 'auth-service',
    });
    // The window starts when the run was started, not when it failed
    expect(params.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(params.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(params.createReader().params).toEqual({
      projectName: 'shop',
      targetEnv: 'dev',
      credentials: ctx.credentials,
    });
    expect(process.exitCode).toBe(1);
  });

  it("should leave a failed run's lines out with lines false", async () => {
    mockRunAndWait.mockResolvedValue({
      success: false,
      taskArn: 't',
      exitCode: 1,
      reason: 'Essential container in task exited',
    });

    await awsRunCron(ctx, { job: 'usage-report', lines: false });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"usage-report" failed (exit code 1): Essential container in task exited',
    );
    expect(mockPrintFailedRunLines).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Log: npx tsdevstack infra:logs usage-report --env dev',
    );
    expect(process.exitCode).toBe(1);
  });

  it('should explain when the cron job is not deployed', async () => {
    mockSchedulerSend.mockRejectedValue(
      Object.assign(new Error('Schedule not found'), {
        name: 'ResourceNotFoundException',
      }),
    );

    await expect(
      awsRunCron(ctx, { job: 'usage-report' }),
    ).rejects.toMatchObject({
      message:
        '"usage-report" is not deployed in dev (no schedule shop-auth-service-usage-report)',
      hint: 'Deploy it first: npx tsdevstack infra:deploy-schedulers --env dev',
    });
    expect(mockRunAndWait).not.toHaveBeenCalled();
  });

  it("should pass a refused start on with AWS's reason", async () => {
    mockRunAndWait.mockRejectedValue(
      Object.assign(new Error('ECS did not start the task'), {
        hint: 'RESOURCE:CPU',
      }),
    );

    await expect(
      awsRunCron(ctx, { job: 'usage-report' }),
    ).rejects.toMatchObject({
      message:
        'Could not run "usage-report": ECS did not start the task (RESOURCE:CPU)',
      hint: 'Log: npx tsdevstack infra:logs usage-report --env dev',
    });
  });

  it('should start a trigger through its job function', async () => {
    await awsRunCron(ctx, { job: 'cleanup-tokens' });

    expect(mockRunTriggerNow).toHaveBeenCalledWith(
      ctx,
      {
        name: 'cleanup-tokens',
        schedule: '0 3 * * *',
        targetService: 'auth-service',
        endpoint: '/auth/jobs/cleanup-tokens',
      },
      { lines: undefined },
    );
    expect(mockSchedulerSend).not.toHaveBeenCalled();
    expect(mockRunAndWait).not.toHaveBeenCalled();
  });

  it("should pass lines false on to a trigger's run", async () => {
    await awsRunCron(ctx, { job: 'cleanup-tokens', lines: false });

    expect(mockRunTriggerNow).toHaveBeenCalledWith(ctx, expect.anything(), {
      lines: false,
    });
  });

  it('should refuse a name that is in no entry', async () => {
    await expect(awsRunCron(ctx, { job: 'nope' })).rejects.toMatchObject({
      message: 'Scheduled job "nope" is not in dev',
    });
  });
});
