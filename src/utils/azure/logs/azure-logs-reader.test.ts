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
// --follow: the live apps and the reconnects are tested on their own
const appFollows: Array<{
  params: { source: { name: string }; app: string; resourceGroup: string };
  what: { output: boolean; events: boolean };
}> = [];
rs.mock('./azure-app-follower', () => ({
  AzureAppFollower: class {
    constructor(
      private readonly params: {
        source: { name: string };
        app: string;
        resourceGroup: string;
      },
    ) {}
    async follow(what: { output: boolean; events: boolean }): Promise<void> {
      appFollows.push({ params: this.params, what });
    }
  },
}));
const kuduFollows: Array<{ source: { name: string }; app: string }> = [];
rs.mock('./follow-azure-kudu-stream', () => ({
  followAzureKuduStream: async (params: {
    source: { name: string };
    app: string;
  }) => {
    kuduFollows.push({ source: params.source, app: params.app });
  },
}));
rs.mock('../../logs/follow-log-stream', () => ({ followLogStream: rs.fn() }));

import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { followLogStream } from '../../logs/follow-log-stream';
import { AzureLogsReader } from './azure-logs-reader';
import type {
  LogEntry,
  LogsFollowQuery,
  LogsQuery,
  LogStreamEnd,
} from '../../logs/types';
import type { AzureContainerAppsClient } from './types';

const queryResource = rs.fn();
const credentials = {
  clientId: 'c',
  tenantId: 't',
  subscriptionId: 'sub-1',
  location: 'swedencentral',
} as AzureCredentials;

function reader(
  options: { appServicePrivate?: boolean } = {},
): AzureLogsReader {
  return new AzureLogsReader({
    projectName: 'shop',
    targetEnv: 'az4',
    credentials,
    naming: { scheme: 'legacy', subscriptionId: 'sub-1' },
    client: { queryResource },
    containerApps: {} as AzureContainerAppsClient,
    kuduCredential: { getToken: rs.fn() },
    ...options,
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

  describe('follow', () => {
    const ALL: LogsFollowQuery = {
      sources: [
        { name: 'auth-service', type: 'service' },
        { name: 'auth-worker', type: 'worker' },
        { name: 'kong', type: 'kong' },
        { name: 'migrate-auth-service', type: 'migration' },
        { name: 'edge', type: 'edge' },
      ],
    };

    type Open = (
      onOpen: () => void,
      signal: AbortSignal,
    ) => Promise<LogStreamEnd>;

    async function startFollow(
      query: LogsFollowQuery,
      options: { appServicePrivate?: boolean } = {},
    ) {
      appFollows.length = 0;
      kuduFollows.length = 0;
      const streams: Array<{ name: string; open: Open }> = [];
      rs.mocked(followLogStream).mockImplementation(async (params) => {
        streams.push({ name: params.name, open: params.open });
      });
      const handlers = { onEntries: rs.fn(), onNotice: rs.fn() };
      await reader(options).follow(
        query,
        handlers,
        new AbortController().signal,
      );
      return { streams, handlers };
    }

    it('should follow services and workers live and read the rest from Log Analytics', async () => {
      const { streams, handlers } = await startFollow(ALL);

      expect(
        appFollows.map(({ params, what }) => [
          params.source.name,
          params.app,
          params.resourceGroup,
          what,
        ]),
      ).toEqual([
        [
          'auth-service',
          'shop-auth-service',
          'shop-az4-rg',
          { output: true, events: true },
        ],
        [
          'auth-worker',
          'shop-auth-worker',
          'shop-az4-rg',
          { output: true, events: true },
        ],
      ]);
      expect(kuduFollows).toEqual([
        { source: { name: 'kong', type: 'kong' }, app: 'shop-az4-kong' },
      ]);
      expect(streams.map((stream) => stream.name)).toEqual(['Log Analytics']);
      expect(handlers.onNotice).toHaveBeenCalledWith(
        'migrate-auth-service, edge: from Log Analytics every 30 seconds, so their lines show up 1 to 10 minutes after they are written.',
      );
      expect(handlers.onNotice).toHaveBeenCalledWith(
        "kong: App Service's request log from Log Analytics every 30 seconds, 1 to 10 minutes late (the rest is live).",
      );
    });

    it("should follow each Next.js app from its Kudu site under the environment's names", async () => {
      await startFollow({
        sources: [
          { name: 'frontend', type: 'frontend' },
          { name: 'admin', type: 'frontend' },
        ],
      });

      expect(kuduFollows.map(({ app }) => app)).toEqual([
        'shop-az4-frontend',
        'shop-az4-admin',
      ]);
    });

    it('should read the late sources from the command start on, through the same query', async () => {
      queryResource.mockResolvedValue(rows());
      const { streams } = await startFollow({
        sources: [{ name: 'kong', type: 'kong' }],
      });

      // The first check covers the time since the command started
      await new Promise((resolve) => setTimeout(resolve, 5));
      const controller = new AbortController();
      const onOpen = rs.fn(() => controller.abort());
      await expect(streams[0].open(onOpen, controller.signal)).resolves.toBe(
        'dropped',
      );

      expect(onOpen).toHaveBeenCalledTimes(1);
      const [, kql] = queryResource.mock.calls[0] as [string, string];
      // Its output and events come live from Kudu
      expect(kql).toContain('AppServiceHTTPLogs');
      expect(kql).not.toContain('AppServiceConsoleLogs');
    });

    it('should leave the events out with --kind app, and sources without app lines', async () => {
      const { streams, handlers } = await startFollow({ ...ALL, kind: 'app' });

      expect(appFollows.map(({ what }) => what)).toEqual([
        { output: true, events: false },
        { output: true, events: false },
      ]);
      expect(kuduFollows.map(({ app }) => app)).toEqual(['shop-az4-kong']);
      expect(streams).toHaveLength(1);
      // App Service's request log is a platform line: nothing late for kong
      expect(handlers.onNotice).toHaveBeenCalledWith(
        'migrate-auth-service: from Log Analytics every 30 seconds, so their lines show up 1 to 10 minutes after they are written.',
      );
      expect(handlers.onNotice).toHaveBeenCalledTimes(1);
    });

    it('should read Kong and Next.js from Log Analytics when their public access is off (Front Door Premium)', async () => {
      queryResource.mockResolvedValue(rows());
      const { streams, handlers } = await startFollow(
        { sources: [{ name: 'kong', type: 'kong' }] },
        { appServicePrivate: true },
      );

      expect(kuduFollows).toEqual([]);
      expect(handlers.onNotice).toHaveBeenCalledWith(
        'kong: from Log Analytics every 30 seconds, so their lines show up 1 to 10 minutes after they are written.',
      );
      // The first check covers the time since the command started
      await new Promise((resolve) => setTimeout(resolve, 5));
      const controller = new AbortController();
      await streams[0].open(() => controller.abort(), controller.signal);
      const [, kql] = queryResource.mock.calls[0] as [string, string];
      expect(kql).toContain('AppServiceConsoleLogs');
    });

    it('should say when no selected source has lines of the kind', async () => {
      const { streams, handlers } = await startFollow({
        sources: [{ name: 'auth-service', type: 'service' }],
        kind: 'edge',
      });

      expect(appFollows).toEqual([]);
      expect(kuduFollows).toEqual([]);
      expect(streams).toEqual([]);
      expect(handlers.onNotice).toHaveBeenCalledWith(
        'No selected source has edge lines.',
      );
    });
  });
});
