import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { followLogs } from './follow-logs';
import { LogPrinter } from './log-printer';
import type {
  LogEntry,
  LogsFollowHandlers,
  LogsFollowQuery,
  LogsReader,
} from './types';

type Follow = LogsReader['follow'];

function line(message: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    time: '2026-11-10T12:00:00.000Z',
    source: 'auth-service',
    kind: 'app',
    level: 'info',
    message,
    raw: {},
    ...overrides,
  };
}

/** A follow session that hands over lines, then waits for the signal */
function session(batches: LogEntry[][]) {
  return rs.fn<Follow>(
    (_query, handlers: LogsFollowHandlers, signal) =>
      new Promise<void>((resolve) => {
        for (const batch of batches) {
          handlers.onEntries(batch);
        }
        signal.addEventListener('abort', () => resolve());
      }),
  );
}

const QUERY: LogsFollowQuery = {
  sources: [{ name: 'auth-service', type: 'service' }],
  level: 'warn',
};

const write = rs.fn();
const notice = rs.fn();

function printer(): LogPrinter {
  return new LogPrinter({
    json: false,
    raw: false,
    color: false,
    sourceWidth: 12,
    filters: QUERY,
    write,
  });
}

function written(): string {
  return write.mock.calls.map((call) => call[0]).join('');
}

/** Ctrl+C, pressed by the test */
function interrupt() {
  let stop: (() => void) | undefined;
  const stopListening = rs.fn();
  return {
    onInterrupt: (handler: () => void) => {
      stop = handler;
      return stopListening;
    },
    press: () => stop?.(),
    stopListening,
  };
}

describe('followLogs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should print new lines through the filters until Ctrl+C', async () => {
      const ctrlC = interrupt();
      const follow = session([
        [line('Slow query', { level: 'warn' }), line('Started')],
        [line('Failed', { level: 'error' })],
      ]);

      const done = followLogs({
        follow,
        query: QUERY,
        printer: printer(),
        notice,
        timeLimit: true,
        onInterrupt: ctrlC.onInterrupt,
      });
      ctrlC.press();
      await done;

      expect(follow).toHaveBeenCalledWith(
        QUERY,
        expect.anything(),
        expect.any(AbortSignal),
      );
      expect(written()).toContain('Slow query');
      expect(written()).toContain('Failed');
      expect(written()).not.toContain('Started');
      expect(notice).not.toHaveBeenCalled();
      expect(ctrlC.stopListening).toHaveBeenCalledTimes(1);
    });

    it('should stop at the time limit and say how to keep following', async () => {
      const ctrlC = interrupt();
      const follow = session([[line('Failed', { level: 'error' })]]);

      await followLogs({
        follow,
        query: QUERY,
        printer: printer(),
        notice,
        timeLimit: true,
        timeLimitMs: 5,
        onInterrupt: ctrlC.onInterrupt,
      });

      expect(notice).toHaveBeenCalledWith(
        'Stopped after 1 hour. Run the command again to keep following, or add --no-time-limit.',
      );
      expect(ctrlC.stopListening).toHaveBeenCalledTimes(1);
    });

    it('should not stop by itself with --no-time-limit', async () => {
      const ctrlC = interrupt();
      const follow = session([]);

      const done = followLogs({
        follow,
        query: QUERY,
        printer: printer(),
        notice,
        timeLimit: false,
        timeLimitMs: 5,
        onInterrupt: ctrlC.onInterrupt,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const signal = follow.mock.calls[0][2];
      expect(signal.aborted).toBe(false);

      ctrlC.press();
      await done;
      expect(signal.aborted).toBe(true);
      expect(notice).toHaveBeenCalledWith('No new lines.');
    });

    it('should pass on the session notices', async () => {
      const ctrlC = interrupt();
      const follow = rs.fn<Follow>(async (_query, handlers) => {
        handlers.onNotice('Reconnected to auth-service.');
      });

      await followLogs({
        follow,
        query: QUERY,
        printer: printer(),
        notice,
        timeLimit: true,
        onInterrupt: ctrlC.onInterrupt,
      });

      expect(notice).toHaveBeenCalledWith('Reconnected to auth-service.');
    });
  });

  describe('Edge cases', () => {
    it('should say when nothing new came before Ctrl+C', async () => {
      const ctrlC = interrupt();
      const follow = session([]);

      const done = followLogs({
        follow,
        query: QUERY,
        printer: printer(),
        notice,
        timeLimit: true,
        onInterrupt: ctrlC.onInterrupt,
      });
      ctrlC.press();
      await done;

      expect(notice.mock.calls).toEqual([['No new lines.']]);
    });

    it('should report an error from the session and stop listening for Ctrl+C', async () => {
      const ctrlC = interrupt();
      const follow = rs.fn<Follow>(async () => {
        throw new Error('AccessDeniedException');
      });

      await expect(
        followLogs({
          follow,
          query: QUERY,
          printer: printer(),
          notice,
          timeLimit: true,
          onInterrupt: ctrlC.onInterrupt,
        }),
      ).rejects.toThrow('AccessDeniedException');
      expect(ctrlC.stopListening).toHaveBeenCalledTimes(1);
    });

    it('should not report an error thrown while closing on Ctrl+C', async () => {
      const ctrlC = interrupt();
      const follow = rs.fn<Follow>(
        (_query, _handlers, signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new Error('stream cancelled')),
            );
          }),
      );

      const done = followLogs({
        follow,
        query: QUERY,
        printer: printer(),
        notice,
        timeLimit: true,
        onInterrupt: ctrlC.onInterrupt,
      });
      ctrlC.press();

      await expect(done).resolves.toBeUndefined();
    });
  });
});
