/**
 * Tests for awsListSchedulers
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getScheduledJobs: rs.fn(),
}));

const mockSend = rs.fn();

rs.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: rs.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  ListSchedulesCommand: rs.fn(),
}));

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'us-east-1' })),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  isCronJob: (job: { type?: string }) => job.type === 'cron',
  CRON_JOB_NAME_PREFIX: 'cron-',
}));

const mockReadLastRun = rs.fn();
rs.mock('./read-aws-cron-job-last-run', () => ({
  readAwsCronJobLastRun: (...args: unknown[]) => mockReadLastRun(...args),
}));

import { awsListSchedulers } from './list-schedulers';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getScheduledJobs } from '../../infrastructure/merge-with-defaults';
import { ListSchedulesCommand } from '@aws-sdk/client-scheduler';

describe('awsListSchedulers', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    runningInCI: false,
  };

  const mockJobs = [
    {
      name: 'cleanup-tokens',
      schedule: '0 0 * * *',
      targetService: 'auth-service',
      endpoint: '/auth/jobs/cleanup-tokens',
    },
    {
      name: 'sync-prices',
      schedule: '0 */4 * * *',
      targetService: 'offers-service',
      endpoint: '/offers/jobs/sync-prices',
    },
  ];

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();
    rs.mocked(loadInfrastructureConfig).mockReturnValue({ version: '1' });
    rs.mocked(getScheduledJobs).mockReturnValue(mockJobs);
  });

  it('should warn and return when no jobs configured', async () => {
    rs.mocked(getScheduledJobs).mockReturnValue([]);

    await awsListSchedulers(mockCtx);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No scheduled jobs configured'),
    );
  });

  it('should show deployed status for matching schedules', async () => {
    mockSend.mockResolvedValue({
      Schedules: [
        {
          Name: 'my-app-auth-service-cleanup-tokens',
          State: 'ENABLED',
        },
      ],
      NextToken: undefined,
    });

    await awsListSchedulers(mockCtx);

    expect(mocks.logger.success).toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalled(); // sync-prices NOT_FOUND
  });

  it('should show not found status for missing schedules', async () => {
    mockSend.mockResolvedValue({
      Schedules: [],
      NextToken: undefined,
    });

    await awsListSchedulers(mockCtx);

    // Both jobs should be NOT_FOUND
    const warnCalls = rs.mocked(mocks.logger.warn).mock.calls;
    const notFoundCalls = warnCalls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('NOT FOUND'),
    );
    expect(notFoundCalls).toHaveLength(2);
  });

  it('should handle pagination', async () => {
    mockSend
      .mockResolvedValueOnce({
        Schedules: [
          {
            Name: 'my-app-auth-service-cleanup-tokens',
            State: 'ENABLED',
          },
        ],
        NextToken: 'page-2-token',
      })
      .mockResolvedValueOnce({
        Schedules: [
          {
            Name: 'my-app-offers-service-sync-prices',
            State: 'ENABLED',
          },
        ],
        NextToken: undefined,
      });

    await awsListSchedulers(mockCtx);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('All 2 jobs are deployed'),
    );
  });

  it('should throw on API error', async () => {
    mockSend.mockRejectedValue(new Error('Access denied'));

    await expect(awsListSchedulers(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should log deploy hint when jobs are not found', async () => {
    mockSend.mockResolvedValue({
      Schedules: [],
      NextToken: undefined,
    });

    await awsListSchedulers(mockCtx);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not deployed'),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('infra:deploy-schedulers'),
    );
  });

  describe('Cron jobs', () => {
    const cronJob = {
      name: 'usage-report',
      type: 'cron' as const,
      schedule: '0 3 * * *',
      targetService: 'auth-service',
    };

    it("should show a cron job's kind and its last run from its log group", async () => {
      rs.mocked(getScheduledJobs).mockReturnValue([mockJobs[0], cronJob]);
      mockSend.mockResolvedValue({
        Schedules: [
          { Name: 'my-app-auth-service-cleanup-tokens', State: 'ENABLED' },
          { Name: 'my-app-auth-service-usage-report', State: 'ENABLED' },
        ],
      });
      mockReadLastRun.mockResolvedValue('Succeeded 2026-11-20T03:00:41.000Z');

      await awsListSchedulers(mockCtx);

      expect(mockReadLastRun).toHaveBeenCalledWith(
        mockCtx.credentials,
        '/ecs/my-app/cron-usage-report',
      );
      const rows = rs
        .mocked(mocks.logger.success)
        .mock.calls.map(([line]) => String(line));
      expect(rows.find((row) => row.startsWith('usage-report'))).toMatch(
        /^usage-report +\| cron +\| 0 3 \* \* \* +\| auth-service +\| ✓ ENABLED +\| Succeeded 2026-11-20T03:00:41.000Z$/,
      );
      expect(rows.find((row) => row.startsWith('cleanup-tokens'))).toMatch(
        /\| trigger \|.*\| -$/,
      );
    });

    it("should say when a cron job's log can't be read", async () => {
      rs.mocked(getScheduledJobs).mockReturnValue([cronJob]);
      mockSend.mockResolvedValue({
        Schedules: [
          { Name: 'my-app-auth-service-usage-report', State: 'ENABLED' },
        ],
      });
      mockReadLastRun.mockRejectedValue(new Error('AccessDenied'));

      await awsListSchedulers(mockCtx);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('? (log not readable)'),
      );
    });

    it('should read no log for a cron job whose schedule is not deployed', async () => {
      rs.mocked(getScheduledJobs).mockReturnValue([cronJob]);
      mockSend.mockResolvedValue({ Schedules: [] });

      await awsListSchedulers(mockCtx);

      expect(mockReadLastRun).not.toHaveBeenCalled();
    });
  });

  it('should use NamePrefix to filter schedules', async () => {
    mockSend.mockResolvedValue({
      Schedules: [],
      NextToken: undefined,
    });

    await awsListSchedulers(mockCtx);

    expect(ListSchedulesCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        NamePrefix: 'my-app-',
        GroupName: 'default',
      }),
    );
  });
});
