import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const logger = { info: rs.fn(), warn: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger }),
}));

import { printFailedRunLines } from './print-failed-run-lines';
import type { LogEntry, LogSource, LogsReader } from './types';

const SOURCE: LogSource = {
  name: 'usage-report',
  type: 'cron',
  service: 'auth-service',
};
const STARTED = new Date('2026-11-22T11:43:22.000Z');
const NOW = new Date('2026-11-22T11:44:30.000Z');

function line(
  time: string,
  message: string,
  overrides: Partial<LogEntry> = {},
): LogEntry {
  return {
    time,
    source: 'usage-report',
    kind: 'app',
    level: 'info',
    message,
    raw: {},
    ...overrides,
  };
}

const STARTING = line(
  '2026-11-22T11:44:19.812Z',
  'Starting Nest application...',
);
const FAILED = line(
  '2026-11-22T11:44:20.113Z',
  'Cron job "usage-report" failed',
  {
    level: 'error',
    fields: {
      context: 'Cron',
      error: { name: 'Error', message: 'no database', stack: 's' },
    },
  },
);
const FINISHED = line('2026-11-22T11:44:20.114Z', 'cron job finished', {
  fields: { context: 'Cron', outcome: 'failed', exitCode: 1, durationMs: 3 },
});
const EXIT = line('2026-11-22T11:44:20.180Z', 'Container called exit(1).', {
  kind: 'platform',
  level: 'warn',
});

const reader = {
  lastLogged: rs.fn(),
  read: rs.fn(),
  readNewest: rs.fn(),
  follow: rs.fn(),
};
const write = rs.fn();
const wait = rs.fn(async () => {});

function print(overrides: Record<string, unknown> = {}): Promise<void> {
  return printFailedRunLines({
    createReader: () => reader as unknown as LogsReader,
    source: SOURCE,
    startedAt: STARTED,
    now: () => NOW,
    wait,
    write,
    ...overrides,
  });
}

describe('printFailedRunLines', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    delete process.env.NO_COLOR;
  });

  describe('Standard use cases', () => {
    it("should read the job's newest 50 lines since the start, a minute wider on both sides", async () => {
      reader.readNewest.mockResolvedValue({
        entries: [STARTING, FAILED, FINISHED, EXIT],
        more: false,
      });

      await print();

      expect(wait).toHaveBeenCalledWith(3000);
      expect(reader.readNewest).toHaveBeenCalledTimes(1);
      expect(reader.readNewest).toHaveBeenCalledWith(
        {
          sources: [SOURCE],
          since: new Date('2026-11-22T11:42:22.000Z'),
          until: new Date('2026-11-22T11:45:30.000Z'),
        },
        50,
      );
    });

    it('should print the lines as infra:logs does, oldest first, times in UTC', async () => {
      reader.readNewest.mockResolvedValue({
        entries: [STARTING, FAILED, FINISHED, EXIT],
        more: false,
      });

      await print();

      expect(write).toHaveBeenCalledWith(
        [
          '2026-11-22 11:44:19.812  usage-report  app       INFO   Starting Nest application...',
          '2026-11-22 11:44:20.113  usage-report  app       ERROR  [Cron] Cron job "usage-report" failed (Error: no database)',
          '2026-11-22 11:44:20.114  usage-report  app       INFO   [Cron] cron job finished (failed, exit code 1, 3 ms)',
          '2026-11-22 11:44:20.180  usage-report  platform  WARN   Container called exit(1).',
          '',
        ].join('\n'),
      );
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("Lines that aren't readable yet", () => {
    it("should read again until the runner's last line is there", async () => {
      // As on GCP: the exit line is readable before the lines written before it
      reader.readNewest
        .mockResolvedValueOnce({ entries: [STARTING, EXIT], more: false })
        .mockResolvedValueOnce({ entries: [STARTING, EXIT], more: false })
        .mockResolvedValueOnce({
          entries: [STARTING, FAILED, FINISHED, EXIT],
          more: false,
        });

      await print();

      expect(reader.readNewest).toHaveBeenCalledTimes(3);
      expect(wait).toHaveBeenCalledTimes(3);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0][0]).toContain('cron job finished (failed');
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("should not take an earlier run's last line for this run's", async () => {
      // Inside the window through the clock margin, written before the start
      const earlier = line('2026-11-22T11:42:50.000Z', 'cron job finished', {
        fields: { outcome: 'succeeded', exitCode: 0, durationMs: 900 },
      });
      reader.readNewest
        .mockResolvedValueOnce({ entries: [earlier, STARTING], more: false })
        .mockResolvedValueOnce({
          entries: [earlier, STARTING, FAILED, FINISHED],
          more: false,
        });

      await print();

      expect(reader.readNewest).toHaveBeenCalledTimes(2);
    });

    it('should show what it has after 5 reads and say the last line is missing', async () => {
      reader.readNewest.mockResolvedValue({
        entries: [STARTING, EXIT],
        more: false,
      });

      await print();

      expect(reader.readNewest).toHaveBeenCalledTimes(5);
      expect(write).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        'No "cron job finished" line among them: the process was killed, or its last lines are not readable yet.',
      );
    });
  });

  describe('Edge cases', () => {
    it('should say so when there are no lines at all', async () => {
      reader.readNewest.mockResolvedValue({ entries: [], more: false });

      await print();

      expect(reader.readNewest).toHaveBeenCalledTimes(5);
      expect(logger.info).toHaveBeenCalledWith('No log lines yet.');
      expect(write).not.toHaveBeenCalled();
    });

    it('should report a failed read in one line and not throw', async () => {
      reader.readNewest.mockRejectedValue(new Error('read limit reached'));

      await expect(print()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "Could not read the run's log lines: read limit reached",
      );
    });

    it('should report a reader that cannot be created the same way', async () => {
      await expect(
        print({
          createReader: async () => {
            throw new Error('no naming');
          },
        }),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "Could not read the run's log lines: no naming",
      );
      expect(reader.readNewest).not.toHaveBeenCalled();
    });
  });
});
