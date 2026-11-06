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
rs.mock('../../context', () => ({
  getContext: () => ({ CliError: MockCliError }),
}));

import { runLogsCommand } from './run-logs-command';
import type { LogEntry, LogSource, LogsReader } from './types';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const SOURCES: LogSource[] = [
  { name: 'auth-service', type: 'service' },
  { name: 'kong', type: 'kong' },
];

function line(
  time: string,
  message: string,
  overrides: Partial<LogEntry> = {},
): LogEntry {
  return {
    time,
    source: 'auth-service',
    kind: 'app',
    level: 'info',
    message,
    raw: {},
    ...overrides,
  };
}

const reader = {
  lastLogged: rs.fn(),
  read: rs.fn(),
  readNewest: rs.fn(),
};
const write = rs.fn();
const notice = rs.fn();

function run(sourceName: string | undefined, options: Record<string, unknown>) {
  return runLogsCommand({
    reader: reader as unknown as LogsReader,
    sourceName,
    options: { env: 'dev', ...options },
    targetEnv: 'dev',
    sources: SOURCES,
    now: NOW,
    write,
    notice,
  });
}

function written(): string {
  return write.mock.calls.map((call) => call[0]).join('');
}

function notices(): string[] {
  return notice.mock.calls.map((call) => call[0] as string);
}

describe('runLogsCommand', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should list the sources when none is named', async () => {
      reader.lastLogged.mockResolvedValue([
        { source: SOURCES[0], lastLogged: '2026-10-30T11:59:00.000Z' },
        { source: SOURCES[1] },
      ]);

      await run(undefined, {});

      expect(reader.lastLogged).toHaveBeenCalledWith(SOURCES, NOW);
      expect(written()).toContain('auth-service  service  2026-10-30 11:59:00');
      expect(reader.read).not.toHaveBeenCalled();
    });

    it('should read one source over the last hour by default and print every page', async () => {
      reader.read.mockImplementation(async (_query, onPage) => {
        onPage([line('2026-10-30T11:10:00.000Z', 'first')]);
        onPage([line('2026-10-30T11:20:00.000Z', 'second')]);
      });

      await run('auth-service', {});

      const query = reader.read.mock.calls[0][0];
      expect(query.sources).toEqual([SOURCES[0]]);
      expect(query.since.toISOString()).toBe('2026-10-30T11:00:00.000Z');
      expect(query.until).toEqual(NOW);
      expect(written()).toContain('first');
      expect(written()).toContain('second');
      expect(notices()).toEqual([
        'auth-service in dev, 2026-10-30 11:00:00 to 2026-10-30 12:00:00 (times in UTC)',
      ]);
    });

    it('should read every source with --all and pass the filters', async () => {
      reader.read.mockResolvedValue(undefined);

      await run(undefined, {
        all: true,
        since: '2d',
        until: '1h',
        level: 'WARN',
        kind: 'app',
        grep: 'timeout',
      });

      const query = reader.read.mock.calls[0][0];
      expect(query.sources).toEqual(SOURCES);
      expect(query.since.toISOString()).toBe('2026-10-28T12:00:00.000Z');
      expect(query.until.toISOString()).toBe('2026-10-30T11:00:00.000Z');
      expect(query).toMatchObject({
        level: 'warn',
        kind: 'app',
        grep: 'timeout',
      });
      expect(notices()).toContain(
        '--level leaves out lines without a level (Kong, frontends, other plain text).',
      );
      expect(notices()).toContain('No lines in this window.');
    });

    it('should print the newest lines and say which were left out', async () => {
      reader.readNewest.mockResolvedValue({
        entries: [
          line('2026-10-30T11:50:00.000Z', 'b'),
          line('2026-10-30T11:55:00.000Z', 'c'),
        ],
        more: true,
      });

      await run('auth-service', { newest: '2', json: true, raw: false });

      expect(reader.readNewest.mock.calls[0][1]).toBe(2);
      const lines = written()
        .trim()
        .split('\n')
        .map((text) => JSON.parse(text));
      expect(lines.map((l) => l.message)).toEqual(['b', 'c']);
      expect(lines[0].raw).toBeUndefined();
      expect(notices()).toContain(
        'Showing the newest 2 lines (2026-10-30 11:50:00 to 2026-10-30 11:55:00). Lines between 2026-10-30 11:00:00 and 2026-10-30 11:50:00 were left out. Narrow the query with --since, --level, --grep or --kind.',
      );
    });

    it('should count the left-out lines when the provider can', async () => {
      reader.readNewest.mockResolvedValue({
        entries: [line('2026-10-30T11:50:00.000Z', 'b')],
        more: true,
        total: 40,
      });

      await run('auth-service', { newest: '1' });

      expect(notices().some((text) => text.includes('39 lines between'))).toBe(
        true,
      );
    });
  });

  describe('Edge cases', () => {
    it('should refuse a source name together with --all', async () => {
      await expect(run('kong', { all: true })).rejects.toThrow(
        'Name a source or use --all, not both',
      );
    });

    it('should refuse an empty time window', async () => {
      await expect(run('kong', { since: '1h', until: '2h' })).rejects.toThrow(
        'The time window is empty',
      );
    });

    it('should refuse an invalid --newest', async () => {
      await expect(run('kong', { newest: '0' })).rejects.toThrow(
        'Invalid --newest: 0',
      );
      await expect(run('kong', { newest: 'ten' })).rejects.toThrow(
        'Invalid --newest: ten',
      );
    });

    it('should say when the newest read found nothing', async () => {
      reader.readNewest.mockResolvedValue({ entries: [], more: false });

      await run('kong', { newest: '5' });

      expect(notices()).toContain('No lines in this window.');
    });
  });
});
