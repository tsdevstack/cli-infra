import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { pollLogLines } from './poll-log-lines';
import type { LogEntry } from './types';

const START = new Date('2026-11-10T12:00:00.000Z');
const plus = (seconds: number): Date =>
  new Date(START.getTime() + seconds * 1000);

function event(seconds: number, message: string): LogEntry {
  return {
    time: plus(seconds).toISOString(),
    source: 'auth-service',
    kind: 'platform',
    level: 'info',
    message,
    raw: {},
  };
}

const onEntries = rs.fn();
const onOpen = rs.fn();

/** Answers one scripted result per check, then stops the loop */
function checks(results: LogEntry[][], controller: AbortController) {
  const times = results.map((_, i) => plus(10 * (i + 1)));
  let call = 0;
  const list = rs.fn(async (_since: Date, _until: Date) => {
    const result = results[call];
    call += 1;
    if (!result) {
      controller.abort();
      return [];
    }
    return result;
  });
  let tick = 0;
  const now = () => times[Math.min(tick++, times.length - 1)];
  return { list, now };
}

describe('pollLogLines', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should print new lines once, across overlapping checks', async () => {
      const controller = new AbortController();
      const { list, now } = checks(
        [
          [event(5, 'has started 1 tasks')],
          [
            event(5, 'has started 1 tasks'),
            event(15, 'reached a steady state'),
          ],
          [event(15, 'reached a steady state'), event(25, 'stopped')],
        ],
        controller,
      );

      await expect(
        pollLogLines({
          list,
          onEntries,
          onOpen,
          signal: controller.signal,
          start: START,
          now,
          intervalMs: 0,
          overlapMs: 60_000,
        }),
      ).resolves.toBe('dropped');

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(
        onEntries.mock.calls.map((call) =>
          (call[0] as LogEntry[]).map((entry) => entry.message),
        ),
      ).toEqual([
        ['has started 1 tasks'],
        ['reached a steady state'],
        ['stopped'],
      ]);
    });

    it('should look back past the previous check, but never before the start', async () => {
      const controller = new AbortController();
      const { list, now } = checks([[], [], []], controller);

      await pollLogLines({
        list,
        onEntries,
        onOpen,
        signal: controller.signal,
        start: START,
        now,
        intervalMs: 0,
        overlapMs: 15_000,
      });

      const windows = list.mock.calls
        .slice(0, 3)
        .map((call) => [
          (call[0] as Date).toISOString(),
          (call[1] as Date).toISOString(),
        ]);
      expect(windows).toEqual([
        ['2026-11-10T12:00:00.000Z', '2026-11-10T12:00:10.000Z'],
        ['2026-11-10T12:00:00.000Z', '2026-11-10T12:00:20.000Z'],
        ['2026-11-10T12:00:05.000Z', '2026-11-10T12:00:30.000Z'],
      ]);
      expect(onEntries).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should fail when a check fails (followLogStream tries again)', async () => {
      const list = rs.fn(async () => {
        throw new Error('ThrottlingException');
      });

      await expect(
        pollLogLines({
          list,
          onEntries,
          onOpen,
          signal: new AbortController().signal,
          start: START,
          intervalMs: 0,
          overlapMs: 0,
        }),
      ).rejects.toThrow('ThrottlingException');
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('should stop while waiting for the next check', async () => {
      const controller = new AbortController();
      const list = rs.fn(async () => {
        setTimeout(() => controller.abort(), 5);
        return [];
      });

      await expect(
        pollLogLines({
          list,
          onEntries,
          onOpen,
          signal: controller.signal,
          start: START,
          intervalMs: 60_000,
          overlapMs: 0,
        }),
      ).resolves.toBe('dropped');
      expect(list).toHaveBeenCalledTimes(1);
    });
  });
});
