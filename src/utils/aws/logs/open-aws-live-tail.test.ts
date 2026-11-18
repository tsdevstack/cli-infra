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
  getContext: () => ({ CliError: MockCliError }),
}));

import {
  StartLiveTailCommand,
  type CloudWatchLogsClient,
  type StartLiveTailResponseStream,
} from '@aws-sdk/client-cloudwatch-logs';
import { openAwsLiveTail } from './open-aws-live-tail';
import type { AwsLiveTailSession } from './types';

const GROUP = '/ecs/shop/auth-service';
const ARN = `arn:aws:logs:eu-west-1:123:log-group:${GROUP}`;

const session: AwsLiveTailSession = {
  region: 'eu-west-1',
  logGroups: [{ name: GROUP, arn: ARN }],
  reads: [
    {
      source: { name: 'auth-service', type: 'service' },
      logGroupName: GROUP,
      region: 'eu-west-1',
      kind: 'app',
      format: 'app',
    },
  ],
};

const send = rs.fn();
const client = { send } as unknown as CloudWatchLogsClient;
const handlers = { onEntries: rs.fn(), onNotice: rs.fn() };
const onOpen = rs.fn();

function respondWith(events: StartLiveTailResponseStream[]): void {
  send.mockResolvedValueOnce({
    responseStream: (async function* () {
      yield* events;
    })(),
  });
}

function update(message: string, sampled = false): StartLiveTailResponseStream {
  return {
    sessionUpdate: {
      sessionMetadata: { sampled },
      sessionResults: [
        {
          logGroupIdentifier: ARN,
          logStreamName: 'ecs/auth-service/abc',
          timestamp: Date.UTC(2026, 10, 10, 12, 0, 1),
          message,
        },
      ],
    },
  };
}

function open(
  signal = new AbortController().signal,
  withSession: AwsLiveTailSession = session,
) {
  return openAwsLiveTail({
    client,
    session: withSession,
    handlers,
    onOpen,
    signal,
  });
}

describe('openAwsLiveTail', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    send.mockReset();
  });

  describe('Standard use cases', () => {
    it('should open on the session start and hand over each update', async () => {
      respondWith([
        { sessionStart: { sessionId: 's1' } },
        update('first'),
        { sessionUpdate: { sessionResults: [] } },
        update('second'),
      ]);

      await expect(open()).resolves.toBe('dropped');

      const command = send.mock.calls[0][0] as StartLiveTailCommand;
      expect(command).toBeInstanceOf(StartLiveTailCommand);
      expect(command.input).toEqual({ logGroupIdentifiers: [ARN] });
      expect(onOpen).toHaveBeenCalledTimes(1);
      const messages = handlers.onEntries.mock.calls.map(
        (call) => (call[0] as Array<{ message: string }>)[0].message,
      );
      expect(messages).toEqual(['first', 'second']);
    });

    it("should pass the session's filter pattern", async () => {
      respondWith([]);

      await open(new AbortController().signal, {
        ...session,
        filterPattern: '{ $.level = "error" }',
      });

      expect((send.mock.calls[0][0] as StartLiveTailCommand).input).toEqual({
        logGroupIdentifiers: [ARN],
        logEventFilterPattern: '{ $.level = "error" }',
      });
    });

    it('should say once that AWS sends a sample', async () => {
      respondWith([{ sessionStart: {} }, update('a', true), update('b', true)]);

      await open();

      expect(handlers.onNotice.mock.calls).toEqual([
        [
          'Live Tail is showing a sample: more than 500 lines a second match (AWS sends at most 500).',
        ],
      ]);
    });

    it('should end as dropped when AWS ends the session after 3 hours', async () => {
      respondWith([
        { sessionStart: {} },
        {
          SessionTimeoutException: {
            name: 'SessionTimeoutException',
            message: 'timed out',
            $fault: 'client',
          } as never,
        },
        update('never read'),
      ]);

      await expect(open()).resolves.toBe('dropped');
      expect(handlers.onEntries).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it("should fail on AWS's streaming error", async () => {
      respondWith([
        { sessionStart: {} },
        {
          SessionStreamingException: {
            name: 'SessionStreamingException',
            message: 'internal',
            $fault: 'client',
          } as never,
        },
      ]);

      await expect(open()).rejects.toThrow('Live Tail stopped: internal');
    });

    it('should name the missing permission', async () => {
      send.mockRejectedValueOnce(
        Object.assign(new Error('not authorized'), {
          name: 'AccessDeniedException',
        }),
      );

      await expect(open()).rejects.toMatchObject({
        message: 'Cannot follow CloudWatch Logs: not authorized',
        hint: 'The deploy credentials need logs:StartLiveTail.',
      });
    });

    it("should explain AWS's limit of 15 sessions", async () => {
      send.mockRejectedValueOnce(
        Object.assign(new Error('too many'), {
          name: 'LimitExceededException',
        }),
      );

      await expect(open()).rejects.toMatchObject({
        hint: 'AWS allows 15 Live Tail sessions at once per account and region (the console counts too). Close one, or ask AWS for more in Service Quotas.',
      });
    });

    it('should end quietly when the signal aborts', async () => {
      const controller = new AbortController();
      send.mockImplementationOnce(
        async (_command: unknown, options: { abortSignal: AbortSignal }) => ({
          responseStream: (async function* () {
            yield { sessionStart: {} };
            await new Promise((_resolve, reject) =>
              options.abortSignal.addEventListener('abort', () =>
                reject(new Error('Request aborted')),
              ),
            );
          })(),
        }),
      );

      const done = open(controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 5));
      controller.abort();

      await expect(done).resolves.toBe('dropped');
      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });
});
