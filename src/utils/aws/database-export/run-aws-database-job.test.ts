import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockSend, mockGetTerraformOutput, mockReadLogTail, mockSleep } =
  rs.hoisted(() => ({
    mockSend: rs.fn(),
    mockGetTerraformOutput: rs.fn(),
    mockReadLogTail: rs.fn(),
    mockSleep: rs.fn(),
  }));

rs.mock('@aws-sdk/client-ecs', () => {
  const command = (type: string) =>
    class {
      type = type;
      constructor(public input: unknown) {}
    };
  return {
    ECSClient: class {
      send = mockSend;
    },
    RunTaskCommand: command('run'),
    DescribeTasksCommand: command('describe'),
    StopTaskCommand: command('stop'),
  };
});
rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: () => ({}),
  DB_EXPORT_JOB_TIMEOUT_SECONDS: 3600,
  ECS_TASK_EXIT_CODE_GRACE_POLLS: 2,
  sleep: mockSleep,
  readEcsTaskOutcome: (task: {
    lastStatus: string;
    containers?: Array<{ exitCode?: number }>;
  }) => {
    if (task.lastStatus !== 'STOPPED') {
      return { state: 'running', lastStatus: task.lastStatus };
    }
    const exitCode = task.containers?.[0]?.exitCode;
    if (exitCode === undefined) {
      return { state: 'exit-code-pending', lastStatus: 'STOPPED' };
    }
    return {
      state: exitCode === 0 ? 'succeeded' : 'failed',
      lastStatus: 'STOPPED',
      exitCode,
    };
  },
}));
rs.mock('../terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));
rs.mock('./read-db-init-log-tail', () => ({
  readDbInitLogTail: mockReadLogTail,
}));
rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { runAwsDatabaseJob } from './run-aws-database-job';
import type { AWSCommandContext } from '../commands/types';

const outputs: Record<string, string> = {
  private_subnet_ids: '["subnet-a","subnet-b"]',
  ecs_security_group_id: 'sg-1',
  db_exports_bucket: 'shop-db-exports-123456789012',
};
const ctx = {
  projectRoot: '/p',
  targetEnv: 'dev',
  projectName: 'shop',
  credentials: { region: 'eu-west-1' },
} as unknown as AWSCommandContext;
const options = {
  ctx,
  mode: 'export' as const,
  serviceName: 'auth-service',
  file: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
};
const taskArn = 'arn:aws:ecs:eu-west-1:123456789012:task/shop-cluster/abc';

type Sent = { type: string; input: Record<string, unknown> };
const sent = (type: string): Sent[] =>
  mockSend.mock.calls
    .map((call) => call[0] as Sent)
    .filter((command) => command.type === type);

/** The task's states, one per status check, then the last one forever */
const taskStates = (...states: Array<Record<string, unknown> | Error>) => {
  mockSend.mockImplementation(async (command: Sent) => {
    if (command.type === 'run') return { tasks: [{ taskArn }] };
    if (command.type === 'stop') return {};
    const state = states.length > 1 ? states.shift() : states[0];
    if (state instanceof Error) throw state;
    return { tasks: [state] };
  });
};

describe('runAwsDatabaseJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockGetTerraformOutput.mockImplementation(
      (_dir: string, name: string) => outputs[name],
    );
    mockReadLogTail.mockResolvedValue(
      'db-init failed: No database auth-service',
    );
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  describe('Standard use cases', () => {
    it('should run db-init in the private subnets with the file and the bucket', async () => {
      taskStates(
        { lastStatus: 'RUNNING' },
        { lastStatus: 'STOPPED', containers: [{ exitCode: 0 }] },
      );

      await runAwsDatabaseJob(options);

      const [run] = sent('run');
      expect(run.input).toMatchObject({
        cluster: 'shop-cluster',
        taskDefinition: 'shop-db-init',
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: ['subnet-a', 'subnet-b'],
            securityGroups: ['sg-1'],
            assignPublicIp: 'DISABLED',
          },
        },
      });
      expect(run.input.overrides).toEqual({
        containerOverrides: [
          {
            name: 'db-init',
            environment: [
              { name: 'MODE', value: 'export' },
              { name: 'SERVICES', value: '["auth-service"]' },
              {
                name: 'EXPORT_FILE',
                value: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
              },
              { name: 'EXPORT_BUCKET', value: 'shop-db-exports-123456789012' },
            ],
          },
        ],
      });
      expect(sent('describe')).toHaveLength(2);
      expect(sent('stop')).toHaveLength(0);
    });

    it('should fail with the end of the log when db-init fails', async () => {
      taskStates({ lastStatus: 'STOPPED', containers: [{ exitCode: 1 }] });

      await expect(runAwsDatabaseJob(options)).rejects.toMatchObject({
        message: 'db-init (export) failed: exit code 1',
        hint: 'db-init failed: No database auth-service',
      });
      expect(mockReadLogTail).toHaveBeenCalledWith({
        projectName: 'shop',
        taskArn,
        credentials: ctx.credentials,
      });
    });
  });

  describe('Edge cases', () => {
    it("should fail when the task doesn't start", async () => {
      mockSend.mockResolvedValue({
        tasks: [],
        failures: [{ reason: 'RESOURCE:ENI' }],
      });

      await expect(runAwsDatabaseJob(options)).rejects.toMatchObject({
        message:
          'db-init (export) failed: the task did not start (RESOURCE:ENI)',
      });
    });

    it('should name the log group when the log has nothing', async () => {
      taskStates({ lastStatus: 'STOPPED', containers: [{ exitCode: 1 }] });
      mockReadLogTail.mockResolvedValue(null);

      await expect(runAwsDatabaseJob(options)).rejects.toMatchObject({
        hint: 'Its output is in the CloudWatch log group /ecs/shop/db-init.',
      });
    });

    it('should keep checking through a few checks with no answer', async () => {
      taskStates(new Error('socket hang up'), new Error('socket hang up'), {
        lastStatus: 'STOPPED',
        containers: [{ exitCode: 0 }],
      });

      await runAwsDatabaseJob(options);

      expect(sent('describe')).toHaveLength(3);
    });

    it('should give up when the status stays unreadable', async () => {
      taskStates(new Error('AccessDeniedException'));

      await expect(runAwsDatabaseJob(options)).rejects.toMatchObject({
        message: expect.stringContaining(
          "its status can't be read (AccessDeniedException)",
        ),
      });
      expect(sent('describe')).toHaveLength(6);
    });

    it('should wait for an exit code a few times, then fail', async () => {
      taskStates({ lastStatus: 'STOPPED', containers: [{}] });

      await expect(runAwsDatabaseJob(options)).rejects.toMatchObject({
        message:
          'db-init (export) failed: the task stopped without an exit code',
      });
      expect(sent('describe')).toHaveLength(3);
    });

    it('should stop the task past the time limit', async () => {
      let now = 0;
      rs.spyOn(Date, 'now').mockImplementation(() => now);
      mockSleep.mockImplementation(async () => {
        now += 30 * 60 * 1000;
      });
      taskStates({ lastStatus: 'RUNNING' });

      await expect(runAwsDatabaseJob(options)).rejects.toMatchObject({
        message:
          'db-init (export) failed: it ran longer than 60 minutes and was stopped',
      });
      expect(sent('stop')[0].input).toEqual({
        cluster: 'shop-cluster',
        task: taskArn,
        reason: 'Over the time limit of the database job',
      });
    });
  });
});
