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

import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { AzureLogsReader } from './azure-logs-reader';
import type { LogEntry, LogsQuery } from '../../logs/types';

const queryResource = rs.fn();
const credentials = {
  clientId: 'c',
  tenantId: 't',
  subscriptionId: 'sub-1',
  location: 'swedencentral',
} as AzureCredentials;

function reader(): AzureLogsReader {
  return new AzureLogsReader({
    projectName: 'shop',
    targetEnv: 'az4',
    credentials,
    client: { queryResource },
  });
}

const COLUMNS = ['TimeGenerated', 'Source', 'Kind', 'Level', 'Text', 'Raw'].map(
  (name) => ({ name }),
);
function rows(...lines: Array<[string, string]>) {
  return {
    status: 'Success',
    tables: [
      {
        name: 'PrimaryResult',
        columnDescriptors: COLUMNS,
        rows: lines.map(([time, msg]) => [
          new Date(time),
          'auth-service',
          'app',
          '',
          JSON.stringify({ level: 'info', msg }),
          {},
        ]),
      },
    ],
  };
}

const QUERY: LogsQuery = {
  sources: [{ name: 'auth-service', type: 'service' }],
  since: new Date('2026-10-30T11:00:00.000Z'),
  until: new Date('2026-10-30T11:30:00.000Z'),
};

describe('AzureLogsReader', () => {
  beforeEach(() => {
    queryResource.mockReset();
  });

  describe('Standard use cases', () => {
    it('should read the window in slices, oldest first, from the workspace', async () => {
      queryResource
        .mockResolvedValueOnce(rows(['2026-10-30T11:05:00.000Z', 'first']))
        .mockResolvedValueOnce(rows(['2026-10-30T11:20:00.000Z', 'second']));

      const pages: LogEntry[][] = [];
      await reader().read(QUERY, (entries) => pages.push(entries));

      expect(pages.map((page) => page.map((e) => e.message))).toEqual([
        ['first'],
        ['second'],
      ]);
      const [resourceId, kql, timespan] = queryResource.mock.calls[0];
      // No leading slash: the SDK adds its own (v1//subscriptions is a 403)
      expect(resourceId).toBe(
        'subscriptions/sub-1/resourceGroups/shop-az4-rg/providers/Microsoft.OperationalInsights/workspaces/shop-az4-logs',
      );
      expect(kql).toContain(
        'TimeGenerated < datetime(2026-10-30T11:15:00.000Z)',
      );
      expect(kql).toContain('| order by TimeGenerated asc');
      expect(timespan.startTime).toEqual(new Date('2026-10-30T11:00:00.000Z'));
      expect(queryResource.mock.calls[1][1]).toContain(
        'TimeGenerated <= datetime(2026-10-30T11:30:00.000Z)',
      );
    });

    it('should return the newest lines and count the rest', async () => {
      queryResource.mockImplementation(async (_id: string, kql: string) => {
        if (kql.endsWith('| count')) {
          return {
            status: 'Success',
            tables: [
              {
                name: 'r',
                columnDescriptors: [{ name: 'Count' }],
                rows: [[42]],
              },
            ],
          };
        }
        return kql.includes('11:15:00.000Z) and')
          ? rows(
              ['2026-10-30T11:25:00.000Z', 'c'],
              ['2026-10-30T11:20:00.000Z', 'b'],
            )
          : rows(['2026-10-30T11:05:00.000Z', 'a']);
      });

      const result = await reader().readNewest(QUERY, 2);

      expect(result.entries.map((e) => e.message)).toEqual(['b', 'c']);
      expect(result.more).toBe(true);
      expect(result.total).toBe(42);
      expect(queryResource.mock.calls[0][1]).toContain(
        '| order by TimeGenerated desc',
      );
    });

    it("should find each source's last line in one query", async () => {
      queryResource.mockResolvedValue({
        status: 'Success',
        tables: [
          {
            name: 'r',
            columnDescriptors: [{ name: 'Source' }, { name: 'Last' }],
            rows: [['auth-service', new Date('2026-10-30T11:58:00.000Z')]],
          },
        ],
      });

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
      expect(queryResource).toHaveBeenCalledTimes(1);
      expect(queryResource.mock.calls[0][1]).toContain(
        '| summarize Last = max(TimeGenerated) by Source',
      );
    });
  });

  describe('Edge cases', () => {
    it('should split a slice that is too big for one query', async () => {
      queryResource
        .mockResolvedValueOnce({
          status: 'PartialFailure',
          partialTables: [],
          partialError: {
            code: 'E_QUERY_RESULT_SET_TOO_LARGE',
            message: 'too large',
          },
        })
        .mockResolvedValue(rows());

      const pages: LogEntry[][] = [];
      await reader().read(
        { ...QUERY, until: new Date('2026-10-30T11:10:00.000Z') },
        (entries) => pages.push(entries),
      );

      expect(queryResource).toHaveBeenCalledTimes(3);
      expect(queryResource.mock.calls[1][1]).toContain(
        'TimeGenerated < datetime(2026-10-30T11:05:00.000Z)',
      );
    });

    it('should read nothing when no table exists yet', async () => {
      queryResource.mockRejectedValue(
        new Error(
          "'union' operator: Failed to resolve table expression named 'AzureDiagnostics'",
        ),
      );

      const pages: LogEntry[][] = [];
      await reader().read(QUERY, (entries) => pages.push(entries));

      expect(pages.flat()).toEqual([]);
    });

    it('should name the access the credentials need', async () => {
      queryResource.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      );

      await expect(reader().read(QUERY, () => undefined)).rejects.toMatchObject(
        {
          message: 'Cannot read Log Analytics: Forbidden',
          hint: 'The deploy credentials need read access to the workspace shop-az4-logs (Contributor on the resource group includes it).',
        },
      );
    });

    it('should not count when --grep or --level narrow the lines here', async () => {
      queryResource.mockResolvedValue(
        rows(
          ['2026-10-30T11:25:00.000Z', 'c'],
          ['2026-10-30T11:20:00.000Z', 'b'],
        ),
      );

      const result = await reader().readNewest({ ...QUERY, grep: 'b' }, 1);

      expect(result.total).toBeUndefined();
      expect(
        queryResource.mock.calls.some((call) =>
          String(call[1]).endsWith('| count'),
        ),
      ).toBe(false);
    });
  });
});
