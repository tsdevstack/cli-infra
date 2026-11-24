import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockSend = rs.fn();
rs.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: class {
    send = mockSend;
  },
  DescribeLogStreamsCommand: class {
    constructor(public input: unknown) {}
  },
  GetLogEventsCommand: class {
    constructor(public input: unknown) {}
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  CRON_FINISHED_MESSAGE: 'cron job finished',
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));

import { readAwsCronJobLastRun } from './read-aws-cron-job-last-run';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'k',
  secretAccessKey: 's',
  accountId: '123456789012',
};
const at = Date.UTC(2026, 10, 20, 3, 0, 41);
const finished = (outcome: string) =>
  JSON.stringify({
    level: 'info',
    msg: 'cron job finished',
    outcome,
    exitCode: outcome === 'succeeded' ? 0 : 1,
  });

describe('readAwsCronJobLastRun', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should read the outcome from the newest stream's end line", async () => {
    mockSend
      .mockResolvedValueOnce({
        logStreams: [{ logStreamName: 'ecs/cron-usage-report/t2' }],
      })
      .mockResolvedValueOnce({
        events: [
          { message: '{"msg":"started"}', timestamp: at - 1000 },
          { message: finished('succeeded'), timestamp: at },
        ],
      });

    await expect(
      readAwsCronJobLastRun(credentials, '/ecs/shop/cron-usage-report'),
    ).resolves.toBe('Succeeded 2026-11-20T03:00:41.000Z');
    expect(mockSend.mock.calls[0][0].input).toEqual({
      logGroupName: '/ecs/shop/cron-usage-report',
      orderBy: 'LastEventTime',
      descending: true,
      limit: 1,
    });
    expect(mockSend.mock.calls[1][0].input).toEqual({
      logGroupName: '/ecs/shop/cron-usage-report',
      logStreamName: 'ecs/cron-usage-report/t2',
      startFromHead: false,
      limit: 50,
    });
  });

  it('should show a failed or skipped run', async () => {
    mockSend
      .mockResolvedValueOnce({ logStreams: [{ logStreamName: 's' }] })
      .mockResolvedValueOnce({
        events: [{ message: finished('skipped'), timestamp: at }],
      });

    await expect(readAwsCronJobLastRun(credentials, 'g')).resolves.toBe(
      'Skipped 2026-11-20T03:00:41.000Z',
    );
  });

  it('should say when the newest run has no end line yet', async () => {
    mockSend
      .mockResolvedValueOnce({
        logStreams: [{ logStreamName: 's', creationTime: at }],
      })
      .mockResolvedValueOnce({
        events: [{ message: 'plain text', timestamp: at }],
      });

    await expect(readAwsCronJobLastRun(credentials, 'g')).resolves.toBe(
      'No end line (started 2026-11-20T03:00:41.000Z)',
    );
  });

  it('should say never ran without a log group or a stream', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('gone'), { name: 'ResourceNotFoundException' }),
    );
    await expect(readAwsCronJobLastRun(credentials, 'g')).resolves.toBe(
      'never ran',
    );

    mockSend.mockResolvedValueOnce({ logStreams: [] });
    await expect(readAwsCronJobLastRun(credentials, 'g')).resolves.toBe(
      'never ran',
    );
  });
});
