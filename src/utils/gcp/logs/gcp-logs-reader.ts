/**
 * GCP Logs Reader
 *
 * Reads Cloud Logging through entries.list (REST), which returns plain JSON
 * entries. Every call counts against Google's limit of 60 reads per minute
 * per project. When the limit is hit, reading stops: lines already printed
 * stay, and the error links to the same query in the Logs Explorer.
 */

import { google, type logging_v2 } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import {
  GCP_LOGGING_READ_SCOPE,
  GCP_LOGS_PAGE_SIZE,
  LOG_SOURCE_LIST_WINDOW_DAYS,
} from '../../../constants';
import { matchesLogFilters } from '../../logs/matches-log-filters';
import type {
  LogEntry,
  LogSource,
  LogSourceLastLogged,
  LogsQuery,
  LogsReader,
  NewestLogsResult,
} from '../../logs/types';
import { buildGcpLogsFilter } from './build-gcp-logs-filter';
import { buildGcpLogsExplorerUrl } from './build-gcp-logs-explorer-url';
import { isGcpLogsQuotaError } from './is-gcp-logs-quota-error';
import { normalizeGcpLogEntry } from './normalize-gcp-log-entry';

interface GcpLogsReaderParams {
  projectName: string;
  targetEnv: string;
  credentials: GCPCredentials;
  /** For tests */
  logging?: logging_v2.Logging;
}

interface PageRequest {
  filter: string;
  orderBy: 'timestamp asc' | 'timestamp desc';
  pageSize: number;
  pageToken?: string;
  /** For the Logs Explorer link when the read limit is hit */
  explorer: { filter: string; since: Date; until: Date };
}

export class GcpLogsReader implements LogsReader {
  private readonly logging: logging_v2.Logging;

  constructor(private readonly params: GcpLogsReaderParams) {
    this.logging =
      params.logging ??
      google.logging({
        version: 'v2',
        auth: new google.auth.GoogleAuth({
          projectId: params.credentials.project_id,
          // Only pass credentials if we have a private key (not ADC mode)
          ...(params.credentials.private_key && {
            credentials: {
              client_email: params.credentials.client_email,
              private_key: params.credentials.private_key,
            },
          }),
          scopes: [GCP_LOGGING_READ_SCOPE],
        }),
      });
  }

  async lastLogged(
    sources: LogSource[],
    now: Date,
  ): Promise<LogSourceLastLogged[]> {
    const since = new Date(
      now.getTime() - LOG_SOURCE_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    // At the read limit, the link shows every source of the list
    const explorer = this.explorerFor({ sources, since, until: now });

    return Promise.all(
      sources.map(async (source) => {
        const query: LogsQuery = { sources: [source], since, until: now };
        const filter = buildGcpLogsFilter(query, this.params.projectName);
        if (!filter) {
          return { source };
        }

        // Cloud Logging can answer with an empty page and a token while it
        // scans: keep going until a line or the end
        let pageToken: string | undefined;
        do {
          const page = await this.listPage({
            filter,
            orderBy: 'timestamp desc',
            pageSize: 1,
            pageToken,
            explorer,
          });
          const [entry] = page.entries;
          if (entry) {
            return {
              source,
              lastLogged: normalizeGcpLogEntry(entry, this.params.projectName)
                .time,
            };
          }
          pageToken = page.nextPageToken;
        } while (pageToken);

        return { source };
      }),
    );
  }

  async read(
    query: LogsQuery,
    onPage: (entries: LogEntry[]) => void,
  ): Promise<void> {
    const filter = buildGcpLogsFilter(query, this.params.projectName);
    if (!filter) {
      return;
    }

    let pageToken: string | undefined;
    do {
      const page = await this.listPage({
        filter,
        orderBy: 'timestamp asc',
        pageSize: GCP_LOGS_PAGE_SIZE,
        pageToken,
        explorer: this.explorerFor(query),
      });
      onPage(
        page.entries.map((entry) =>
          normalizeGcpLogEntry(entry, this.params.projectName),
        ),
      );
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  async readNewest(query: LogsQuery, limit: number): Promise<NewestLogsResult> {
    const filter = buildGcpLogsFilter(query, this.params.projectName);
    if (!filter) {
      return { entries: [], more: false };
    }

    // One line past the limit tells whether older lines were left out
    const newestFirst: LogEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.listPage({
        filter,
        orderBy: 'timestamp desc',
        pageSize: Math.min(limit + 1, GCP_LOGS_PAGE_SIZE),
        pageToken,
        explorer: this.explorerFor(query),
      });
      for (const raw of page.entries) {
        const entry = normalizeGcpLogEntry(raw, this.params.projectName);
        if (matchesLogFilters(entry, query)) {
          newestFirst.push(entry);
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken && newestFirst.length <= limit);

    return {
      entries: newestFirst.slice(0, limit).reverse(),
      more: newestFirst.length > limit,
    };
  }

  private explorerFor(query: LogsQuery): PageRequest['explorer'] {
    return {
      filter:
        buildGcpLogsFilter(query, this.params.projectName, {
          includeTime: false,
        }) ?? '',
      since: query.since,
      until: query.until,
    };
  }

  private async listPage(request: PageRequest): Promise<{
    entries: logging_v2.Schema$LogEntry[];
    nextPageToken?: string;
  }> {
    const { CliError } = getContext();
    const projectId = this.params.credentials.project_id;

    try {
      const response = await this.logging.entries.list({
        requestBody: {
          resourceNames: [`projects/${projectId}`],
          filter: request.filter,
          orderBy: request.orderBy,
          pageSize: request.pageSize,
          ...(request.pageToken && { pageToken: request.pageToken }),
        },
      });
      return {
        entries: response.data.entries ?? [],
        nextPageToken: response.data.nextPageToken ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isGcpLogsQuotaError(error)) {
        const url = buildGcpLogsExplorerUrl(
          projectId,
          request.explorer.filter,
          request.explorer.since,
          request.explorer.until,
        );
        throw new CliError(
          `Cloud Logging read limit reached: ${message}`,
          'infra:logs',
          `Google allows 60 log reads per minute per project. Narrow the query with --since, --level, --grep or --kind, or open it in the Logs Explorer:\n${url}`,
        );
      }

      const status = (error as { status?: unknown } | undefined)?.status;
      if (status === 403) {
        throw new CliError(
          `Cannot read Cloud Logging: ${message}`,
          'infra:logs',
          `The deploy account needs the Logs Viewer role (roles/logging.viewer). Run npx tsdevstack infra:bootstrap --env ${this.params.targetEnv} to add it.`,
        );
      }

      throw new CliError(`Cannot read Cloud Logging: ${message}`, 'infra:logs');
    }
  }
}
