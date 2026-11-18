/**
 * Azure Logs Reader
 *
 * Every source's lines come from the environment's Log Analytics workspace
 * (`{project}-{env}-logs`) through one KQL query per time slice. Queries are
 * free on the Analytics plan. Lines reach the workspace 1 to 10 minutes
 * after they are written.
 *
 * --follow:
 * - services and workers (Container Apps) live, from Azure's log streams
 *   (AzureAppFollower);
 * - Kong and the Next.js apps (App Service) live, from their Kudu site's
 *   log stream (followAzureKuduStream): their output and container events.
 *   Not with Front Door Premium: the apps' public access is off, Kudu's
 *   too, so they are read from Log Analytics like the rest;
 * - the rest has no live stream (jobs' is a preview API; Front Door,
 *   buckets and App Service's request log exist only in Log Analytics):
 *   the same queries every AZURE_LOGS_FOLLOW_POLL_MS, lines 1 to 10
 *   minutes late.
 */

import { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { LogsQueryClient } from '@azure/monitor-query-logs';
import type { TokenCredential } from '@azure/identity';
import {
  buildAzureResourceName,
  createAzureCredential,
} from '@tsdevstack/infra-core';
import type { AzureCredentials, AzureNaming } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import {
  AZURE_KUDU_LOG_SOURCE_TYPES,
  AZURE_LIVE_LOG_SOURCE_TYPES,
  AZURE_LOG_WORKSPACE_SUFFIX,
  AZURE_LOGS_FOLLOW_OVERLAP_MS,
  AZURE_LOGS_FOLLOW_POLL_MS,
  AZURE_LOGS_SLICE_MINUTES,
  AZURE_RESOURCE_GROUP_SUFFIX,
  LOG_SOURCE_LIST_WINDOW_DAYS,
} from '../../../constants';
import { buildRuntime } from '../../build-runtime';
import { followLogStream } from '../../logs/follow-log-stream';
import { matchesLogFilters } from '../../logs/matches-log-filters';
import { pollLogLines } from '../../logs/poll-log-lines';
import type {
  LogEntry,
  LogSource,
  LogSourceLastLogged,
  LogsFollowHandlers,
  LogsFollowQuery,
  LogsQuery,
  LogsReader,
  NewestLogsResult,
} from '../../logs/types';
import { AzureAppFollower } from './azure-app-follower';
import { buildAzureLogsQuery } from './build-azure-logs-query';
import { buildAzureSourceLegs } from './build-azure-source-legs';
import { followAzureKuduStream } from './follow-azure-kudu-stream';
import { normalizeAzureLogRow } from './normalize-azure-log-row';
import type { AzureContainerAppsClient, AzureLogsQuery } from './types';

interface AzureLogsReaderParams {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  /** The environment's naming (App Service names) */
  naming: AzureNaming;
  /**
   * The App Service apps have no public access (Front Door Premium): their
   * Kudu sites can't be reached, so --follow reads them from Log Analytics
   */
  appServicePrivate?: boolean;
  /** For tests */
  client?: Pick<LogsQueryClient, 'queryResource'>;
  /** For tests: --follow's Container Apps calls and log streams */
  containerApps?: AzureContainerAppsClient;
  /** For tests: --follow's Kudu sign-in */
  kuduCredential?: Pick<TokenCredential, 'getToken'>;
  fetchFn?: typeof fetch;
}

/** A slice too big for one query; it is split in two */
class SliceTooLarge extends Error {}

const MINUTE_MS = 60 * 1000;

export class AzureLogsReader implements LogsReader {
  private readonly client: Pick<LogsQueryClient, 'queryResource'>;
  private readonly workspaceName: string;
  private readonly workspaceId: string;

  constructor(private readonly params: AzureLogsReaderParams) {
    const { projectName, targetEnv, credentials } = params;
    this.workspaceName = `${projectName}-${targetEnv}${AZURE_LOG_WORKSPACE_SUFFIX}`;
    // No leading slash: the SDK's path template (/{+resourceId}/query) adds
    // its own, and Log Analytics refuses .../v1//subscriptions/... with a 403
    this.workspaceId =
      `subscriptions/${credentials.subscriptionId}` +
      `/resourceGroups/${projectName}-${targetEnv}${AZURE_RESOURCE_GROUP_SUFFIX}` +
      `/providers/Microsoft.OperationalInsights/workspaces/${this.workspaceName}`;
    this.client =
      params.client ??
      new LogsQueryClient(createAzureCredential(buildRuntime(), credentials));
  }

  async lastLogged(
    sources: LogSource[],
    now: Date,
  ): Promise<LogSourceLastLogged[]> {
    const since = new Date(
      now.getTime() - LOG_SOURCE_LIST_WINDOW_DAYS * 24 * MINUTE_MS * 60,
    );
    const kql = buildAzureLogsQuery(
      { sources, since, until: now },
      this.names(),
      { from: since, to: now, includeEnd: true },
      '| summarize Last = max(TimeGenerated) by Source',
    );
    const rows = kql ? await this.run(kql, since, now) : [];

    const last = new Map<string, string>();
    for (const row of rows) {
      const value = row.Last;
      if (value) {
        last.set(
          String(row.Source),
          new Date(value instanceof Date ? value : String(value)).toISOString(),
        );
      }
    }

    return sources.map((source) => {
      const lastLogged = last.get(source.name);
      return lastLogged ? { source, lastLogged } : { source };
    });
  }

  async read(
    query: LogsQuery,
    onPage: (entries: LogEntry[]) => void,
  ): Promise<void> {
    for await (const page of this.slices(query, 'asc')) {
      onPage(page);
    }
  }

  async readNewest(query: LogsQuery, limit: number): Promise<NewestLogsResult> {
    // One line past the limit tells whether older lines were left out
    const newestFirst: LogEntry[] = [];
    for await (const page of this.slices(query, 'desc')) {
      for (const entry of page) {
        if (matchesLogFilters(entry, query)) {
          newestFirst.push(entry);
        }
      }
      if (newestFirst.length > limit) {
        break;
      }
    }

    const more = newestFirst.length > limit;
    // Log Analytics counts exactly what the printer shows only without
    // --grep and --level (those are also checked here)
    let total: number | undefined;
    if (more && !query.grep && !query.level) {
      const kql = buildAzureLogsQuery(
        query,
        this.names(),
        { from: query.since, to: query.until, includeEnd: true },
        '| count',
      );
      if (kql) {
        const [row] = await this.run(kql, query.since, query.until);
        total = Number(row?.Count ?? 0);
      }
    }

    return {
      entries: newestFirst.slice(0, limit).reverse(),
      more,
      ...(total !== undefined && { total }),
    };
  }

  async follow(
    query: LogsFollowQuery,
    handlers: LogsFollowHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    const { projectName, targetEnv, credentials } = this.params;
    const start = new Date();
    const liveTypes = new Set<string>(AZURE_LIVE_LOG_SOURCE_TYPES);
    const output = !query.kind || query.kind === 'app';
    const events = !query.kind || query.kind === 'platform';
    const tasks: Promise<void>[] = [];

    // Services and workers: live
    const live = query.sources.filter((source) => liveTypes.has(source.type));
    if (live.length > 0 && (output || events)) {
      const client =
        this.params.containerApps ??
        new ContainerAppsAPIClient(
          createAzureCredential(buildRuntime(), credentials),
          credentials.subscriptionId,
        );
      for (const source of live) {
        tasks.push(
          new AzureAppFollower({
            source,
            app: `${projectName}-${source.name}`,
            resourceGroup: `${projectName}-${targetEnv}${AZURE_RESOURCE_GROUP_SUFFIX}`,
            client,
            handlers,
            signal,
            ...(this.params.fetchFn && { fetchFn: this.params.fetchFn }),
          }).follow({ output, events }),
        );
      }
    }

    // Kong and the Next.js apps: live from their Kudu site
    const kuduTypes = new Set<string>(AZURE_KUDU_LOG_SOURCE_TYPES);
    const kudu = this.params.appServicePrivate
      ? []
      : query.sources.filter((source) => kuduTypes.has(source.type));
    if (kudu.length > 0 && (output || events)) {
      const credential =
        this.params.kuduCredential ??
        createAzureCredential(buildRuntime(), credentials);
      for (const source of kudu) {
        tasks.push(
          followAzureKuduStream({
            source,
            app: buildAzureResourceName('appService', {
              projectName,
              environment: targetEnv,
              naming: this.params.naming.scheme,
              subscriptionId: this.params.naming.subscriptionId,
              app: source.name,
            }),
            credential,
            handlers,
            signal,
            ...(this.params.fetchFn && { fetchFn: this.params.fetchFn }),
          }),
        );
      }
    }

    // The rest: Log Analytics, late (for Kong and the Next.js apps only
    // App Service's request log)
    const polled = query.sources.filter(
      (source) =>
        !liveTypes.has(source.type) &&
        buildAzureSourceLegs(source, this.names(), {
          kind: query.kind,
          level: query.level,
          appServiceLive: !this.params.appServicePrivate,
        }).length > 0,
    );
    if (polled.length > 0) {
      const late = (sources: LogSource[]): string => {
        const names = sources.map((source) => source.name);
        return names.length <= 3
          ? names.join(', ')
          : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
      };
      const live = (source: LogSource): boolean =>
        kuduTypes.has(source.type) && !this.params.appServicePrivate;
      const appServices = polled.filter(live);
      const others = polled.filter((source) => !live(source));
      if (others.length > 0) {
        handlers.onNotice(
          `${late(others)}: from Log Analytics every ${AZURE_LOGS_FOLLOW_POLL_MS / 1000} seconds, so their lines show up 1 to 10 minutes after they are written.`,
        );
      }
      if (appServices.length > 0) {
        handlers.onNotice(
          `${late(appServices)}: App Service's request log from Log Analytics every ${AZURE_LOGS_FOLLOW_POLL_MS / 1000} seconds, 1 to 10 minutes late (the rest is live).`,
        );
      }
      tasks.push(
        followLogStream({
          name: 'Log Analytics',
          open: (onOpen, streamSignal) =>
            pollLogLines({
              list: (since, until) =>
                this.collect({
                  ...query,
                  sources: polled,
                  since,
                  until,
                  appServiceLive: !this.params.appServicePrivate,
                }),
              onEntries: handlers.onEntries,
              onOpen,
              signal: streamSignal,
              start,
              intervalMs: AZURE_LOGS_FOLLOW_POLL_MS,
              overlapMs: AZURE_LOGS_FOLLOW_OVERLAP_MS,
            }),
          signal,
          notice: handlers.onNotice,
        }),
      );
    }

    if (tasks.length === 0) {
      handlers.onNotice(
        query.kind
          ? `No selected source has ${query.kind} lines.`
          : 'Nothing to follow for the selected sources.',
      );
      return;
    }
    await Promise.all(tasks);
  }

  /** Every line of a window, in one list */
  private async collect(query: AzureLogsQuery): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    for await (const page of this.slices(query, 'asc')) {
      entries.push(...page);
    }
    return entries;
  }

  private names(): {
    projectName: string;
    targetEnv: string;
    naming: AzureNaming;
  } {
    return {
      projectName: this.params.projectName,
      targetEnv: this.params.targetEnv,
      naming: this.params.naming,
    };
  }

  /**
   * The window's lines slice by slice, in the given order. A slice too big
   * for one query is split in half.
   */
  private async *slices(
    query: AzureLogsQuery,
    direction: 'asc' | 'desc',
  ): AsyncGenerator<LogEntry[]> {
    const { CliError } = getContext();
    const sliceMs = AZURE_LOGS_SLICE_MINUTES * MINUTE_MS;
    const start = query.since.getTime();
    const end = query.until.getTime();

    // Slices to read, next one last
    const pending: Array<{ from: number; to: number }> = [];
    for (let from = start; from < end; from += sliceMs) {
      pending.push({ from, to: Math.min(from + sliceMs, end) });
    }
    if (direction === 'asc') {
      pending.reverse();
    }

    while (pending.length > 0) {
      const slice = pending.pop()!;
      const kql = buildAzureLogsQuery(
        query,
        this.names(),
        {
          from: new Date(slice.from),
          to: new Date(slice.to),
          includeEnd: slice.to === end,
        },
        `| order by TimeGenerated ${direction}`,
      );
      if (!kql) {
        return;
      }

      try {
        const rows = await this.run(
          kql,
          new Date(slice.from),
          new Date(slice.to),
        );
        yield rows.map((row) => normalizeAzureLogRow(row));
      } catch (error) {
        if (!(error instanceof SliceTooLarge)) {
          throw error;
        }
        if (slice.to - slice.from <= MINUTE_MS) {
          throw new CliError(
            'Too many log lines in one minute for one Log Analytics query',
            'infra:logs',
            'Narrow the query with --level, --grep or --kind',
          );
        }
        const middle = slice.from + Math.floor((slice.to - slice.from) / 2);
        const halves = [
          { from: slice.from, to: middle },
          { from: middle, to: slice.to },
        ];
        // Next one last
        if (direction === 'asc') {
          halves.reverse();
        }
        pending.push(...halves);
      }
    }
  }

  /** Run one query; rows as objects keyed by column name */
  private async run(
    kql: string,
    from: Date,
    to: Date,
  ): Promise<Array<Record<string, unknown>>> {
    const { CliError } = getContext();

    let result;
    try {
      result = await this.client.queryResource(this.workspaceId, kql, {
        startTime: from,
        endTime: new Date(to.getTime() + 1),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as { statusCode?: unknown } | undefined)
        ?.statusCode;
      // No table of the union exists yet: nothing was logged
      if (/failed to resolve/i.test(message)) {
        return [];
      }
      if (status === 403) {
        throw new CliError(
          `Cannot read Log Analytics: ${message}`,
          'infra:logs',
          `The deploy credentials need read access to the workspace ${this.workspaceName} (Contributor on the resource group includes it).`,
        );
      }
      if (status === 404) {
        throw new CliError(
          `No Log Analytics workspace ${this.workspaceName}`,
          'infra:logs',
          `Deploy the environment first: npx tsdevstack infra:deploy --env ${this.params.targetEnv}`,
        );
      }
      throw new CliError(`Cannot read Log Analytics: ${message}`, 'infra:logs');
    }

    let table;
    if (result.status === 'Success') {
      [table] = result.tables;
    } else {
      const reason = `${result.partialError.code ?? ''} ${result.partialError.message ?? ''}`;
      if (/too.?large|exceed|limit/i.test(reason)) {
        throw new SliceTooLarge(reason);
      }
      throw new CliError(
        `Log Analytics returned part of the result: ${reason.trim()}`,
        'infra:logs',
      );
    }

    if (!table) {
      return [];
    }
    const columns = table.columnDescriptors.map((column) => column.name ?? '');
    return table.rows.map((row) => {
      const record: Record<string, unknown> = {};
      columns.forEach((name, index) => {
        record[name] = row[index];
      });
      return record;
    });
  }
}
