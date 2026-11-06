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

import type { logging_v2 } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { GcpLogsReader } from './gcp-logs-reader';
import type { LogEntry, LogsQuery } from '../../logs/types';

const list = rs.fn();
const logging = { entries: { list } } as unknown as logging_v2.Logging;
const credentials = {
  project_id: 'shop-dev',
  region: 'europe-west1',
} as GCPCredentials;

function reader(): GcpLogsReader {
  return new GcpLogsReader({
    projectName: 'shop',
    targetEnv: 'dev',
    credentials,
    logging,
  });
}

function stdout(service: string, time: string, msg: string, level = 'info') {
  return {
    logName: 'projects/shop-dev/logs/run.googleapis.com%2Fstdout',
    resource: { type: 'cloud_run_revision', labels: { service_name: service } },
    timestamp: time,
    jsonPayload: { level, msg },
  };
}

const QUERY: LogsQuery = {
  sources: [{ name: 'auth-service', type: 'service' }],
  since: new Date('2026-10-30T11:00:00.000Z'),
  until: new Date('2026-10-30T12:00:00.000Z'),
};

describe('GcpLogsReader', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should read every page oldest first and hand each one over', async () => {
      list
        .mockResolvedValueOnce({
          data: {
            entries: [stdout('auth-service', '2026-10-30T11:00:01Z', 'a')],
            nextPageToken: 't1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            entries: [stdout('auth-service', '2026-10-30T11:00:02Z', 'b')],
          },
        });

      const pages: LogEntry[][] = [];
      await reader().read(QUERY, (entries) => pages.push(entries));

      expect(pages.map((page) => page.map((e) => e.message))).toEqual([
        ['a'],
        ['b'],
      ]);
      const first = list.mock.calls[0][0].requestBody;
      expect(first.resourceNames).toEqual(['projects/shop-dev']);
      expect(first.orderBy).toBe('timestamp asc');
      expect(first.pageSize).toBe(1000);
      expect(first.filter).toContain(
        'resource.labels.service_name="auth-service"',
      );
      expect(list.mock.calls[1][0].requestBody.pageToken).toBe('t1');
    });

    it('should return the newest lines oldest first and say when older ones were left out', async () => {
      list.mockResolvedValueOnce({
        data: {
          entries: [
            stdout('auth-service', '2026-10-30T11:59:03Z', 'c'),
            stdout('auth-service', '2026-10-30T11:59:02Z', 'b'),
            stdout('auth-service', '2026-10-30T11:59:01Z', 'a'),
          ],
          nextPageToken: 'more',
        },
      });

      const result = await reader().readNewest(QUERY, 2);

      expect(result.entries.map((e) => e.message)).toEqual(['b', 'c']);
      expect(result.more).toBe(true);
      expect(list).toHaveBeenCalledTimes(1);
      expect(list.mock.calls[0][0].requestBody.orderBy).toBe('timestamp desc');
      expect(list.mock.calls[0][0].requestBody.pageSize).toBe(3);
    });

    it("should find each source's last line", async () => {
      list
        .mockResolvedValueOnce({
          data: {
            entries: [stdout('auth-service', '2026-10-30T11:58:00Z', 'x')],
          },
        })
        .mockResolvedValueOnce({ data: {} });

      const result = await reader().lastLogged(
        [
          { name: 'auth-service', type: 'service' },
          { name: 'edge', type: 'edge' },
        ],
        new Date('2026-10-30T12:00:00.000Z'),
      );

      expect(result).toEqual([
        {
          source: { name: 'auth-service', type: 'service' },
          lastLogged: '2026-10-30T11:58:00.000Z',
        },
        { source: { name: 'edge', type: 'edge' } },
      ]);
      expect(list.mock.calls[0][0].requestBody.filter).toContain(
        'timestamp>="2026-09-30T12:00:00.000Z"',
      );
    });
  });

  describe('Edge cases', () => {
    it('should keep reading past empty pages while Cloud Logging scans', async () => {
      list
        .mockResolvedValueOnce({ data: { entries: [], nextPageToken: 'scan' } })
        .mockResolvedValueOnce({
          data: {
            entries: [stdout('auth-service', '2026-10-30T11:58:00Z', 'x')],
          },
        });

      const result = await reader().lastLogged(
        [{ name: 'auth-service', type: 'service' }],
        new Date('2026-10-30T12:00:00.000Z'),
      );

      expect(result[0].lastLogged).toBe('2026-10-30T11:58:00.000Z');
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('should stop at the read limit with a Logs Explorer link', async () => {
      list.mockRejectedValueOnce(
        Object.assign(
          new Error("Quota exceeded for quota metric 'Read requests'"),
          { status: 429 },
        ),
      );

      try {
        await reader().read(QUERY, () => undefined);
        expect.unreachable();
      } catch (error) {
        const cliError = error as MockCliError;
        expect(cliError.message).toContain('Cloud Logging read limit reached');
        expect(cliError.hint).toContain('60 log reads per minute');
        expect(cliError.hint).toContain(
          'https://console.cloud.google.com/logs/query;query=',
        );
        expect(cliError.hint).toContain('?project=shop-dev');
      }
    });

    it('should link every listed source when the source list hits the limit', async () => {
      list.mockRejectedValue(
        Object.assign(new Error('Quota exceeded'), { status: 429 }),
      );

      try {
        await reader().lastLogged(
          [
            { name: 'auth-service', type: 'service' },
            { name: 'edge', type: 'edge' },
          ],
          new Date('2026-10-30T12:00:00.000Z'),
        );
        expect.unreachable();
      } catch (error) {
        const hint = decodeURIComponent((error as MockCliError).hint ?? '');
        expect(hint).toContain('service_name="auth-service"');
        expect(hint).toContain('url_map_name="shop-urlmap"');
      }
      list.mockReset();
    });

    it('should name the missing role when reading is denied', async () => {
      list.mockRejectedValueOnce(
        Object.assign(new Error('Permission denied'), { status: 403 }),
      );

      await expect(reader().read(QUERY, () => undefined)).rejects.toMatchObject(
        {
          message: 'Cannot read Cloud Logging: Permission denied',
          hint: 'The deploy account needs the Logs Viewer role (roles/logging.viewer). Run npx tsdevstack infra:bootstrap --env dev to add it.',
        },
      );
    });

    it('should not call Cloud Logging when no source has lines of the kind', async () => {
      const pages: LogEntry[][] = [];
      await reader().read({ ...QUERY, kind: 'edge' }, (entries) =>
        pages.push(entries),
      );
      const newest = await reader().readNewest({ ...QUERY, kind: 'edge' }, 10);

      expect(list).not.toHaveBeenCalled();
      expect(pages).toEqual([]);
      expect(newest).toEqual({ entries: [], more: false });
    });

    it('should apply the filters to the newest lines before counting', async () => {
      list.mockResolvedValueOnce({
        data: {
          entries: [
            stdout('auth-service', '2026-10-30T11:59:02Z', 'other'),
            stdout('auth-service', '2026-10-30T11:59:01Z', 'needle here'),
          ],
        },
      });

      const result = await reader().readNewest({ ...QUERY, grep: 'needle' }, 5);

      expect(result.entries.map((e) => e.message)).toEqual(['needle here']);
      expect(result.more).toBe(false);
    });
  });
});
