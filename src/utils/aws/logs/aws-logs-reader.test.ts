import { describe, it, expect, rs, beforeEach } from '@rstest/core';

class MockCliError extends Error {
  constructor(
    message: string,
    public context?: string,
    public hint?: string,
  ) {
    super(message);
  }
}
rs.mock('../../../context', () => ({
  getContext: () => ({ CliError: MockCliError, isCIEnv: () => false }),
}));
// --follow: the tests open the streams themselves (reconnects are
// followLogStream's, tested there)
rs.mock('../../logs/follow-log-stream', () => ({ followLogStream: rs.fn() }));

import {
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
  StartLiveTailCommand,
  type CloudWatchLogsClient,
} from '@aws-sdk/client-cloudwatch-logs';
import { DescribeServicesCommand, type ECSClient } from '@aws-sdk/client-ecs';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { followLogStream } from '../../logs/follow-log-stream';
import { AwsLogsReader } from './aws-logs-reader';
import type {
  LogEntry,
  LogsFollowQuery,
  LogsQuery,
  LogStreamEnd,
} from '../../logs/types';

const logsSend = rs.fn();
const ecsSend = rs.fn();
const regions: string[] = [];
const credentials = {
  accountId: '123',
  accessKeyId: 'a',
  secretAccessKey: 's',
  region: 'eu-west-1',
} as AWSCredentials;

function reader(): AwsLogsReader {
  return new AwsLogsReader({
    projectName: 'shop',
    targetEnv: 'dev',
    credentials,
    clients: {
      logs: (region: string) => {
        regions.push(region);
        return { send: logsSend } as unknown as CloudWatchLogsClient;
      },
      ecs: { send: ecsSend } as unknown as ECSClient,
    },
  });
}

const at = (second: number): number => Date.UTC(2026, 9, 30, 11, 30, second);
const pino = (msg: string, level = 'info'): string =>
  JSON.stringify({ level, msg, service: 'x' });

const QUERY: LogsQuery = {
  sources: [
    { name: 'auth-service', type: 'service' },
    { name: 'kong', type: 'kong' },
  ],
  since: new Date('2026-10-30T11:00:00.000Z'),
  until: new Date('2026-10-30T12:00:00.000Z'),
};

function filterCalls(): Array<FilterLogEventsCommand['input']> {
  return logsSend.mock.calls
    .map((call) => call[0])
    .filter((command) => command instanceof FilterLogEventsCommand)
    .map((command) => (command as FilterLogEventsCommand).input);
}

describe('AwsLogsReader', () => {
  beforeEach(() => {
    logsSend.mockReset();
    ecsSend.mockReset();
    regions.length = 0;
    ecsSend.mockImplementation(async (command: unknown) => {
      if (command instanceof DescribeServicesCommand) {
        return {
          services: [
            {
              serviceName: 'kong',
              events: [
                {
                  createdAt: new Date(at(3)),
                  message: '(service kong) has reached a steady state.',
                },
              ],
            },
          ],
        };
      }
      return { taskArns: [] };
    });
  });

  describe('Standard use cases', () => {
    it('should merge every log group and the ECS events into one timeline', async () => {
      logsSend.mockImplementation(async (command: FilterLogEventsCommand) => {
        if (command.input.logGroupName === '/ecs/shop/auth-service') {
          return command.input.nextToken
            ? { events: [{ timestamp: at(5), message: pino('second page') }] }
            : {
                events: [{ timestamp: at(1), message: pino('first') }],
                nextToken: 'n',
              };
        }
        return { events: [{ timestamp: at(2), message: 'kong text line' }] };
      });

      const pages: LogEntry[][] = [];
      await reader().read(QUERY, (entries) => pages.push(entries));

      expect(
        pages.flat().map((entry) => `${entry.source}:${entry.message}`),
      ).toEqual([
        'auth-service:first',
        'kong:kong text line',
        'kong:has reached a steady state.',
        'auth-service:second page',
      ]);
      expect(filterCalls()[0]).toMatchObject({
        logGroupName: '/ecs/shop/auth-service',
        startTime: QUERY.since.getTime(),
        endTime: QUERY.until.getTime(),
        startFromHead: true,
        limit: 10000,
      });
      expect(regions).toEqual(expect.arrayContaining(['eu-west-1']));
    });

    it("should put a bucket's page in request time order, so the timeline moves on", async () => {
      // CloudTrail delivers records out of their request order
      const record = (eventTime: string, key: string): string =>
        JSON.stringify({
          eventTime,
          eventName: 'GetObject',
          requestParameters: { key },
        });
      logsSend.mockImplementation(async (command: FilterLogEventsCommand) =>
        command.input.logGroupName === '/aws/cloudtrail/shop-storage-access'
          ? {
              events: [
                {
                  timestamp: at(40),
                  message: record('2026-10-30T11:30:05Z', 'b'),
                },
                {
                  timestamp: at(40),
                  message: record('2026-10-30T11:30:01Z', 'a'),
                },
              ],
            }
          : { events: [{ timestamp: at(3), message: pino('app') }] },
      );

      const pages: LogEntry[][] = [];
      await reader().read(
        {
          ...QUERY,
          sources: [
            { name: 'auth-service', type: 'service' },
            { name: 'bucket-uploads', type: 'bucket', bucket: 'uploads' },
          ],
        },
        (entries) => pages.push(entries),
      );

      expect(
        pages
          .flat()
          .filter((entry) => entry.source !== 'kong')
          .map((entry) => `${entry.source} ${entry.time}`),
      ).toEqual([
        'bucket-uploads 2026-10-30T11:30:01.000Z',
        'auth-service 2026-10-30T11:30:03.000Z',
        'bucket-uploads 2026-10-30T11:30:05.000Z',
      ]);
    });

    it('should return the newest lines oldest first and say older ones exist', async () => {
      logsSend.mockImplementation(async (command: FilterLogEventsCommand) =>
        command.input.logGroupName === '/ecs/shop/auth-service'
          ? {
              events: [
                { timestamp: at(9), message: pino('c') },
                { timestamp: at(8), message: pino('b') },
                { timestamp: at(1), message: pino('a') },
              ],
            }
          : { events: [] },
      );

      const result = await reader().readNewest({ ...QUERY, kind: 'app' }, 2);

      expect(result.entries.map((entry) => entry.message)).toEqual(['b', 'c']);
      expect(result.more).toBe(true);
      expect(
        filterCalls().every((input) => input.startFromHead === false),
      ).toBe(true);
      expect(ecsSend).not.toHaveBeenCalled();
    });

    it("should find each source's newest line, reading its own job lines only", async () => {
      logsSend.mockImplementation(async (command: FilterLogEventsCommand) => {
        if (command.input.logGroupName === '/aws/lambda/shop-job-invoker') {
          return command.input.nextToken
            ? {
                events: [
                  {
                    timestamp: at(4),
                    message:
                      '2026-10-30T11:30:04Z\tr1\tINFO\tjob=cleanup-tokens Run finished: 201 in 9ms',
                  },
                ],
              }
            : {
                events: [
                  {
                    timestamp: at(7),
                    message:
                      '2026-10-30T11:30:07Z\tr2\tINFO\tjob=cleanup-tokens-weekly Run started: POST x',
                  },
                ],
                nextToken: 'older',
              };
        }
        return { events: [] };
      });

      const result = await reader().lastLogged(
        [
          { name: 'cleanup-tokens', type: 'job' },
          { name: 'edge', type: 'edge' },
        ],
        new Date('2026-10-30T12:00:00.000Z'),
      );

      expect(result).toEqual([
        {
          source: { name: 'cleanup-tokens', type: 'job' },
          lastLogged: '2026-10-30T11:30:04.000Z',
        },
        { source: { name: 'edge', type: 'edge' } },
      ]);
      const edgeCall = filterCalls().find(
        (input) => input.logGroupName === 'aws-waf-logs-shop-dev',
      );
      expect(edgeCall?.startFromHead).toBe(false);
      expect(regions).toContain('us-east-1');
    });
  });

  describe('Edge cases', () => {
    it('should read a missing log group as no lines', async () => {
      logsSend.mockRejectedValue(
        Object.assign(new Error('The specified log group does not exist.'), {
          name: 'ResourceNotFoundException',
        }),
      );

      const pages: LogEntry[][] = [];
      await reader().read({ ...QUERY, kind: 'app' }, (entries) =>
        pages.push(entries),
      );

      expect(pages.flat()).toEqual([]);
    });

    it('should name the missing permission when reading is denied', async () => {
      logsSend.mockRejectedValue(
        Object.assign(new Error('not authorized'), {
          name: 'AccessDeniedException',
        }),
      );

      await expect(
        reader().read({ ...QUERY, kind: 'app' }, () => undefined),
      ).rejects.toMatchObject({
        message:
          'Cannot read CloudWatch Logs (/ecs/shop/auth-service): not authorized',
        hint: 'The deploy credentials need logs:FilterLogEvents.',
      });
    });

    it('should read no platform lines without the ECS cluster', async () => {
      logsSend.mockResolvedValue({ events: [] });
      ecsSend.mockRejectedValue(
        Object.assign(new Error('Cluster not found.'), {
          name: 'ClusterNotFoundException',
        }),
      );

      const pages: LogEntry[][] = [];
      await reader().read(QUERY, (entries) => pages.push(entries));

      expect(pages.flat()).toEqual([]);
    });

    it('should not read newest-first from before 2024', async () => {
      logsSend.mockResolvedValue({ events: [] });

      await reader().readNewest(
        { ...QUERY, kind: 'app', since: new Date('2023-06-01T00:00:00.000Z') },
        5,
      );

      expect(filterCalls()[0].startTime).toBe(Date.UTC(2024, 0, 1));
    });
  });

  describe('follow', () => {
    const FOLLOW: LogsFollowQuery = {
      sources: [
        { name: 'auth-service', type: 'service' },
        { name: 'migrate-auth-service', type: 'migration' },
        { name: 'edge', type: 'edge' },
      ],
    };

    type Open = (
      onOpen: () => void,
      signal: AbortSignal,
    ) => Promise<LogStreamEnd>;

    /** Start follow; hand back the streams it gives followLogStream */
    async function startFollow(
      query: LogsFollowQuery,
      existingGroups: string[],
    ) {
      const streams: Array<{ name: string; open: Open }> = [];
      rs.mocked(followLogStream).mockImplementation(async (params) => {
        streams.push({ name: params.name, open: params.open });
      });
      logsSend.mockImplementation(async (command: unknown) => {
        if (command instanceof DescribeLogGroupsCommand) {
          return {
            logGroups: (command.input.logGroupIdentifiers ?? [])
              .filter((name) => existingGroups.includes(name))
              .map((name) => ({
                logGroupName: name,
                logGroupArn: `arn:aws:logs:region:123:log-group:${name}`,
              })),
          };
        }
        if (command instanceof StartLiveTailCommand) {
          return {
            responseStream: (async function* () {
              yield { sessionStart: {} };
            })(),
          };
        }
        return {};
      });
      const handlers = { onEntries: rs.fn(), onNotice: rs.fn() };

      await reader().follow(query, handlers, new AbortController().signal);
      return { streams, handlers };
    }

    function describedNames(): string[][] {
      return logsSend.mock.calls
        .map((call) => call[0])
        .filter((command) => command instanceof DescribeLogGroupsCommand)
        .map(
          (command) =>
            (command as DescribeLogGroupsCommand).input.logGroupIdentifiers ??
            [],
        );
    }

    it('should tail the log groups that exist, per region, and ask ECS for platform lines', async () => {
      const { streams, handlers } = await startFollow(FOLLOW, [
        '/ecs/shop/auth-service',
        '/ecs/shop/migrate-auth-service',
        'aws-waf-logs-shop-dev',
      ]);

      expect(regions).toContain('us-east-1');
      expect(describedNames()).toEqual([
        [
          '/ecs/shop/auth-service',
          '/ecs/shop/migrate-auth-service',
          '/ecs/migrate-auth-service-migration',
        ],
        ['aws-waf-logs-shop-dev'],
      ]);
      expect(streams.map((stream) => stream.name)).toEqual([
        'auth-service, migrate-auth-service',
        'edge',
        'ECS events',
      ]);
      expect(handlers.onNotice).toHaveBeenCalledWith(
        'CloudWatch Live Tail: 2 sessions. AWS bills each per minute after its free minutes.',
      );

      // The first session: the two existing groups, by ARN
      const onOpen = rs.fn();
      await streams[0].open(onOpen, new AbortController().signal);
      const tail = logsSend.mock.calls
        .map((call) => call[0])
        .find((command) => command instanceof StartLiveTailCommand) as
        StartLiveTailCommand | undefined;
      expect(tail?.input.logGroupIdentifiers).toEqual([
        'arn:aws:logs:region:123:log-group:/ecs/shop/auth-service',
        'arn:aws:logs:region:123:log-group:/ecs/shop/migrate-auth-service',
      ]);
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('should not ask ECS when only app lines are wanted', async () => {
      const { streams } = await startFollow({ ...FOLLOW, kind: 'app' }, [
        '/ecs/shop/auth-service',
      ]);

      expect(streams.map((stream) => stream.name)).toEqual(['auth-service']);
    });

    it('should hand ECS platform lines from the start on to the printer', async () => {
      const { streams, handlers } = await startFollow(
        { sources: [{ name: 'kong', type: 'kong' }], kind: 'platform' },
        [],
      );
      expect(streams.map((stream) => stream.name)).toEqual(['ECS events']);

      const controller = new AbortController();
      const onOpen = rs.fn(() => controller.abort());
      await expect(streams[0].open(onOpen, controller.signal)).resolves.toBe(
        'dropped',
      );
      expect(onOpen).toHaveBeenCalledTimes(1);
      // The fixture's event is from 2026-10-30, before the command started
      expect(handlers.onEntries).not.toHaveBeenCalled();
    });

    it('should say when there is nothing to follow', async () => {
      const { streams, handlers } = await startFollow(
        { sources: [{ name: 'edge', type: 'edge' }] },
        [],
      );

      expect(streams).toEqual([]);
      expect(handlers.onNotice).toHaveBeenCalledWith(
        'Nothing to follow: none of the selected sources has logged yet.',
      );
    });
  });
});
