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

import { followAzureKuduStream } from './follow-azure-kudu-stream';
import type { LogEntry } from '../../logs/types';

const STREAM = 'https://shop-dev-kong.scm.azurewebsites.net/api/logstream';

type Reply =
  { lines: string[]; end?: boolean } | { status: number; body?: string };

/** fetch: replies in order (the last repeats); a stream without `end` stays open */
function fakeFetch(replies: Reply[]) {
  let call = 0;
  return rs.fn(
    async (
      input: string,
      init: { signal: AbortSignal; headers: Record<string, string> },
    ) => {
      expect(input).toBe(STREAM);
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
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
          init.signal.addEventListener('abort', () =>
            controller.error(new Error('aborted')),
          );
        },
      });
      return new Response(body, { status: 200 });
    },
  );
}

const WELCOME = [
  '2026-11-18T07:45:30  Welcome, you are now connected to log-streaming service.',
  'Starting Log Tail -n 10 of existing logs ----',
  '/home/LogFiles/2026_11_18_lw0_default_docker.log  (https://shop-dev-kong.scm.azurewebsites.net/api/vfs/LogFiles/2026_11_18_lw0_default_docker.log)',
];
const LIVE = [
  'Ending Log Tail of existing logs ---',
  'Starting Live Log Stream ---',
];
const kong = (time: string, text: string): string =>
  `2026-11-18T${time}.1234567Z ${text}`;

const handlers = { onEntries: rs.fn(), onNotice: rs.fn() };
const credential = {
  getToken: rs.fn(async () => ({
    token: 'app-service-token',
    expiresOnTimestamp: Date.now() + 3_600_000,
  })),
};

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

function follow(fetchFn: ReturnType<typeof fakeFetch>, signal: AbortSignal) {
  return followAzureKuduStream({
    source: { name: 'kong', type: 'kong' },
    app: 'shop-dev-kong',
    credential,
    handlers,
    signal,
    fetchFn: fetchFn as unknown as typeof fetch,
    reconnectDelayMs: 0,
  });
}

describe('followAzureKuduStream', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should sign in with an App Service token on the app's Kudu stream", async () => {
      const controller = new AbortController();
      const fetchFn = fakeFetch([{ lines: [...WELCOME, ...LIVE] }]);

      const following = follow(fetchFn, controller.signal);
      await waitFor(() => fetchFn.mock.calls.length > 0);
      controller.abort();
      await following;

      expect(credential.getToken).toHaveBeenCalledWith(
        'https://appservice.azure.com/.default',
      );
      expect(fetchFn.mock.calls[0]?.[1].headers).toEqual({
        Authorization: 'Bearer app-service-token',
      });
    });

    it('should show only the lines after the live marker on the first stream', async () => {
      const controller = new AbortController();
      const fetchFn = fakeFetch([
        {
          lines: [
            ...WELCOME,
            kong('07:40:00', 'replayed line'),
            ...LIVE,
            kong('07:46:14', 'GET /auth/v1/health 404'),
            '2026-11-18T07:46:30    Error occurred, type: error, text: LogStreamManager: ProcessRequest end',
            kong('07:46:31', 'Container is running.'),
          ],
        },
      ]);

      const following = follow(fetchFn, controller.signal);
      await waitFor(() => messages().length === 2);
      controller.abort();
      await following;

      expect(messages()).toEqual([
        'GET /auth/v1/health 404',
        'Container is running.',
      ]);
      const kinds = handlers.onEntries.mock.calls.map(
        (call) => (call[0] as LogEntry[])[0]?.kind,
      );
      expect(kinds).toEqual(['app', 'platform']);
    });
  });

  describe('Edge cases', () => {
    it("should open the stream again when Kudu closes it, filling the gap from Kudu's replay", async () => {
      const controller = new AbortController();
      const fetchFn = fakeFetch([
        {
          lines: [...WELCOME, ...LIVE, kong('07:46:14', 'first')],
          end: true,
        },
        {
          lines: [
            ...WELCOME,
            // Shown before, written while the stream was closed, then live
            kong('07:46:14', 'first'),
            kong('07:47:00', 'in between'),
            ...LIVE,
            kong('07:48:00', 'after'),
          ],
        },
      ]);

      const following = follow(fetchFn, controller.signal);
      await waitFor(() => messages().length === 3);
      controller.abort();
      await following;

      expect(messages()).toEqual(['first', 'in between', 'after']);
      expect(handlers.onNotice).toHaveBeenCalledWith(
        'Reconnected to kong. Lines written in between may be missing.',
      );
    });

    it('should stop with the missing rights when Kudu refuses the sign-in', async () => {
      const fetchFn = fakeFetch([{ status: 401, body: 'Unauthorized' }]);

      const error = await follow(fetchFn, new AbortController().signal).catch(
        (failure: unknown) => failure,
      );

      expect(error).toBeInstanceOf(MockCliError);
      expect((error as MockCliError).message).toContain(
        'Cannot follow kong (shop-dev-kong): HTTP 401',
      );
      expect((error as MockCliError).hint).toContain(
        'Microsoft.Web/sites/publish/Action',
      );
    });

    it('should stop when Azure gives no token', async () => {
      credential.getToken.mockResolvedValueOnce(
        null as unknown as { token: string; expiresOnTimestamp: number },
      );

      await expect(
        follow(fakeFetch([{ lines: [] }]), new AbortController().signal),
      ).rejects.toThrow('Azure gave no App Service token for shop-dev-kong');
    });
  });
});
