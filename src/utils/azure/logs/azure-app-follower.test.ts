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

import { AzureAppFollower } from './azure-app-follower';
import type { LogEntry } from '../../logs/types';
import type { AzureContainerAppsClient } from './types';

const BASE =
  'https://westeurope.azurecontainerapps.dev/subscriptions/s/resourceGroups/shop-dev-rg/containerApps/shop-auth-service';
const logStream = (replica: string): string =>
  `${BASE}/revisions/r1/replicas/${replica}/containers/auth-service/logstream`;
const EVENTS = `${BASE}/eventstream`;

function replica(name: string) {
  return {
    name,
    containers: [
      {
        name: 'auth-service',
        runningState: 'Running',
        logStreamEndpoint: logStream(name),
      },
    ],
  };
}

/** Replicas per check: the last entry repeats */
function fakeClient(replicasPerCheck: string[][]) {
  let check = 0;
  const client = {
    containerApps: {
      getAuthToken: rs.fn(async () => ({
        token: 'stream-token',
        expires: new Date(Date.now() + 3_600_000),
      })),
      get: rs.fn(async () => ({ eventStreamEndpoint: EVENTS })),
    },
    containerAppsRevisions: {
      listRevisions: rs.fn(() =>
        (async function* () {
          yield { name: 'r1', active: true };
        })(),
      ),
    },
    containerAppsRevisionReplicas: {
      listReplicas: rs.fn(async () => {
        const names =
          replicasPerCheck[Math.min(check, replicasPerCheck.length - 1)];
        check += 1;
        return { value: names.map(replica) };
      }),
    },
  };
  return client;
}

type Reply =
  { lines: string[]; end?: boolean } | { status: number; body?: string };

/** fetch: per URL (without the query), replies in order; the last repeats */
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls = new Map<string, number>();
  return rs.fn(async (input: string, init: { signal: AbortSignal }) => {
    const url = new URL(input);
    const key = `${url.origin}${url.pathname}`;
    const list = replies[key] ?? [{ lines: [] }];
    const index = calls.get(key) ?? 0;
    calls.set(key, index + 1);
    const reply = list[Math.min(index, list.length - 1)];
    if ('status' in reply) {
      return new Response(reply.body ?? '', { status: reply.status });
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of reply.lines) {
          controller.enqueue(encoder.encode(`${line}\n`));
        }
        if (reply.end) {
          controller.close();
          return;
        }
        // Stays open until the request is aborted
        init.signal.addEventListener('abort', () =>
          controller.error(new Error('aborted')),
        );
      },
    });
    return new Response(body, { status: 200 });
  });
}

const consoleLine = (msg: string): string =>
  JSON.stringify({
    TimeStamp: '2026-11-10T12:00:01',
    Log: JSON.stringify({ level: 'info', msg }),
  });

const handlers = { onEntries: rs.fn(), onNotice: rs.fn() };

function messages(): string[] {
  return handlers.onEntries.mock.calls.flatMap((call) =>
    (call[0] as LogEntry[]).map((entry) => entry.message),
  );
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(check()).toBe(true);
}

function follower(
  client: ReturnType<typeof fakeClient>,
  fetchFn: ReturnType<typeof fakeFetch>,
  signal: AbortSignal,
): AzureAppFollower {
  return new AzureAppFollower({
    source: { name: 'auth-service', type: 'service' },
    app: 'shop-auth-service',
    resourceGroup: 'shop-dev-rg',
    client: client as unknown as AzureContainerAppsClient,
    handlers,
    signal,
    fetchFn: fetchFn as unknown as typeof fetch,
    checkIntervalMs: 5,
    reconnectDelayMs: 0,
  });
}

function requested(fetchFn: ReturnType<typeof fakeFetch>): URL[] {
  return fetchFn.mock.calls.map((call) => new URL(call[0]));
}

describe('AzureAppFollower', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should stream each replica's output and the app's events", async () => {
      const controller = new AbortController();
      const client = fakeClient([['a'], ['a', 'b']]);
      const fetchFn = fakeFetch({
        [logStream('a')]: [{ lines: [consoleLine('from a')] }],
        [logStream('b')]: [{ lines: [consoleLine('from b')] }],
        [EVENTS]: [
          {
            lines: [
              JSON.stringify({
                Type: 'Normal',
                Reason: 'ReplicaStarted',
                Msg: 'Replica b started',
              }),
            ],
          },
        ],
      });

      const done = follower(client, fetchFn, controller.signal).follow({
        output: true,
        events: true,
      });
      await waitFor(() => messages().length === 3);
      controller.abort();
      await done;

      expect(messages().sort()).toEqual(
        ['ReplicaStarted: Replica b started', 'from a', 'from b'].sort(),
      );
      const urls = requested(fetchFn);
      const a = urls.find((url) => url.pathname.includes('/replicas/a/'));
      const b = urls.find((url) => url.pathname.includes('/replicas/b/'));
      const events = urls.find((url) => url.pathname.endsWith('/eventstream'));
      // Running at the start: new lines only; started later: from its first line
      expect(a?.searchParams.get('tailLines')).toBe('0');
      expect(b?.searchParams.get('tailLines')).toBe('300');
      expect(a?.searchParams.get('follow')).toBe('true');
      expect(a?.searchParams.get('output')).toBe('json');
      expect(events?.searchParams.get('tailLines')).toBe('0');
      expect(fetchFn.mock.calls[0][1]).toMatchObject({
        headers: { Authorization: 'Bearer stream-token' },
      });
      // One token for every stream while it is valid
      expect(client.containerApps.getAuthToken).toHaveBeenCalledTimes(1);
      expect(handlers.onNotice).not.toHaveBeenCalled();
    });

    it('should end a replica stream quietly when the replica stops', async () => {
      const controller = new AbortController();
      const client = fakeClient([['a'], []]);
      const fetchFn = fakeFetch({
        [logStream('a')]: [{ lines: [consoleLine('last words')], end: true }],
      });

      const done = follower(client, fetchFn, controller.signal).follow({
        output: true,
        events: false,
      });
      await waitFor(() => messages().length === 1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      controller.abort();
      await done;

      expect(
        requested(fetchFn).filter((url) =>
          url.pathname.includes('/replicas/a/'),
        ),
      ).toHaveLength(1);
      expect(handlers.onNotice).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should try a stream that cannot open yet again at the next check', async () => {
      const controller = new AbortController();
      const client = fakeClient([['a']]);
      const fetchFn = fakeFetch({
        [logStream('a')]: [
          { status: 500, body: 'not ready' },
          { lines: [consoleLine('ready now')] },
        ],
      });

      const done = follower(client, fetchFn, controller.signal).follow({
        output: true,
        events: false,
      });
      await waitFor(() => messages().length === 1);
      controller.abort();
      await done;

      expect(handlers.onNotice).toHaveBeenCalledWith(
        'Cannot open the stream of auth-service (a) yet: HTTP 500: not ready. Trying again at the next check.',
      );
      // Still the tail it was first given (running at the start: none)
      const opens = requested(fetchFn).filter((url) =>
        url.pathname.includes('/replicas/a/'),
      );
      expect(opens.map((url) => url.searchParams.get('tailLines'))).toEqual([
        '0',
        '0',
      ]);
    });

    it('should stop the command when the stream refuses the sign-in', async () => {
      const controller = new AbortController();
      const client = fakeClient([['a']]);
      const fetchFn = fakeFetch({
        [logStream('a')]: [{ status: 403, body: 'Forbidden' }],
      });

      await expect(
        follower(client, fetchFn, controller.signal).follow({
          output: true,
          events: false,
        }),
      ).rejects.toMatchObject({
        message: 'Cannot follow shop-auth-service: HTTP 403: Forbidden',
        hint: "The deploy credentials need to read the Container App's log stream (Microsoft.App/containerApps/getAuthToken/action, in Contributor).",
      });
      controller.abort();
    });

    it('should fail at once when the events stream is refused', async () => {
      const controller = new AbortController();
      const client = fakeClient([[]]);
      const fetchFn = fakeFetch({
        [EVENTS]: [{ status: 401, body: '' }],
      });

      await expect(
        follower(client, fetchFn, controller.signal).follow({
          output: false,
          events: true,
        }),
      ).rejects.toThrow('Cannot follow shop-auth-service: HTTP 401');
      controller.abort();
    });
  });
});
