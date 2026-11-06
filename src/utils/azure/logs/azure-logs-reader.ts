/**
 * Azure Logs Reader
 *
 * Every source's lines come from the environment's Log Analytics workspace
 * (`{project}-{env}-logs`) through one KQL query per time slice. Queries are
 * free on the Analytics plan. Lines reach the workspace 1 to 10 minutes
 * after they are written.
 */

import { LogsQueryClient } from '@azure/monitor-query-logs';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import {
  AZURE_LOG_WORKSPACE_SUFFIX,
  AZURE_LOGS_SLICE_MINUTES,
  AZURE_RESOURCE_GROUP_SUFFIX,
  LOG_SOURCE_LIST_WINDOW_DAYS,
} from '../../../constants';
import { buildRuntime } from '../../build-runtime';
import { matchesLogFilters } from '../../logs/matches-log-filters';
import type {
  LogEntry,
  LogSource,
  LogSourceLastLogged,
  LogsQuery,
  LogsReader,
  NewestLogsResult,
} from '../../logs/types';
import { buildAzureLogsQuery } from './build-azure-logs-query';
import { normalizeAzureLogRow } from './normalize-azure-log-row';

interface AzureLogsReaderParams {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  /** For tests */
  client?: Pick<LogsQueryClient, 'queryResource'>;
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

  private names(): { projectName: string; targetEnv: string } {
    return {
      projectName: this.params.projectName,
      targetEnv: this.params.targetEnv,
    };
  }

  /**
   * The window's lines slice by slice, in the given order. A slice too big
   * for one query is split in half.
   */
  private async *slices(
    query: LogsQuery,
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
