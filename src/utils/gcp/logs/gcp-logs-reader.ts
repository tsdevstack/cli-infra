/**
 * GCP Logs Reader
 *
 * Reads Cloud Logging through entries.list (REST), which returns plain JSON
 * entries. Every call counts against Google's limit of 60 reads per minute
 * per project. When the limit is hit, reading stops: lines already printed
 * stay, and the error links to the same query in the Logs Explorer.
 *
 * --follow opens one tail stream (gRPC, @google-cloud/logging) with the
 * same filter, without a window: Google allows 10 open at once per project
 * (the Logs Explorer's live mode counts too). Its entries are turned into
 * the REST shape first (toGcpRestLogEntry).
 */

import type { Duplex } from 'stream';
import { Logging } from '@google-cloud/logging';
import { google, type logging_v2 } from 'googleapis';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import {
  buildGcsStorageBucketName,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import {
  GCP_LOGGING_READ_SCOPE,
  GCP_LOGS_PAGE_SIZE,
  GCP_LOGS_TAIL_OPEN_AFTER_MS,
  LOG_SOURCE_LIST_WINDOW_DAYS,
} from '../../../constants';
import { followLogStream } from '../../logs/follow-log-stream';
import { matchesLogFilters } from '../../logs/matches-log-filters';
import type {
  LogEntry,
  LogSource,
  LogSourceLastLogged,
  LogsFollowHandlers,
  LogsFollowQuery,
  LogsQuery,
  LogsReader,
  LogStreamEnd,
  NewestLogsResult,
} from '../../logs/types';
import { buildGcpLogsFilter } from './build-gcp-logs-filter';
import { buildGcpLogsExplorerUrl } from './build-gcp-logs-explorer-url';
import { formatGcpTailSuppression } from './format-gcp-tail-suppression';
import { isGcpLogsQuotaError } from './is-gcp-logs-quota-error';
import { normalizeGcpLogEntry } from './normalize-gcp-log-entry';
import { toGcpRestLogEntry } from './to-gcp-rest-log-entry';
import type { GcpTailRequest, GcpTailResponse } from './types';

interface GcpLogsReaderParams {
  projectName: string;
  targetEnv: string;
  credentials: GCPCredentials;
  /** The environment's naming scheme (Cloud Run and Cloud Scheduler names) */
  naming: NamingScheme;
  /** For tests */
  logging?: logging_v2.Logging;
  /** For tests: open a tail stream (default: @google-cloud/logging) */
  tail?: (request: GcpTailRequest) => Duplex;
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
  private tailClient: Logging | undefined;

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
        const filter = this.filterFor(query);
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
              lastLogged: this.normalize(entry, [source]).time,
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
    const filter = this.filterFor(query);
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
      onPage(page.entries.map((entry) => this.normalize(entry, query.sources)));
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  async readNewest(query: LogsQuery, limit: number): Promise<NewestLogsResult> {
    const filter = this.filterFor(query);
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
        const entry = this.normalize(raw, query.sources);
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

  async follow(
    query: LogsFollowQuery,
    handlers: LogsFollowHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    const filter = this.filterFor(query);
    if (!filter) {
      handlers.onNotice(
        query.kind
          ? `No selected source has ${query.kind} lines.`
          : 'Nothing to follow for the selected sources.',
      );
      return;
    }

    await followLogStream({
      name:
        query.sources.length === 1 ? query.sources[0].name : 'Cloud Logging',
      open: (onOpen, streamSignal) =>
        this.tail(filter, query.sources, handlers, onOpen, streamSignal),
      signal,
      notice: handlers.onNotice,
    });
  }

  /** The query's Cloud Logging filter (storage buckets need the env and project) */
  private filterFor(
    query: LogsFollowQuery & Partial<Pick<LogsQuery, 'since' | 'until'>>,
    includeTime = true,
  ): string | undefined {
    return buildGcpLogsFilter(
      query,
      this.params.projectName,
      this.params.naming,
      {
        includeTime,
        environment: this.params.targetEnv,
        gcpProjectId: this.params.credentials.project_id,
      },
    );
  }

  /** An entry as a line; storage bucket entries get their source by GCS name */
  private normalize(
    entry: logging_v2.Schema$LogEntry,
    sources: LogSource[],
  ): LogEntry {
    const bucketSources: Record<string, string> = {};
    for (const source of sources) {
      if (source.type === 'bucket' && source.bucket) {
        bucketSources[
          buildGcsStorageBucketName({
            projectName: this.params.projectName,
            bucket: source.bucket,
            environment: this.params.targetEnv,
            gcpProjectId: this.params.credentials.project_id,
            naming: this.params.naming,
          })
        ] = source.name;
      }
    }
    return normalizeGcpLogEntry(
      entry,
      this.params.projectName,
      this.params.naming,
      bucketSources,
    );
  }

  private explorerFor(query: LogsQuery): PageRequest['explorer'] {
    return {
      filter: this.filterFor(query, false) ?? '',
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

  /**
   * One tail stream: lines as they arrive, until it ends, fails or the
   * signal aborts. It counts as open at its first response, or after
   * GCP_LOGS_TAIL_OPEN_AFTER_MS without an error.
   */
  private tail(
    filter: string,
    sources: LogSource[],
    handlers: LogsFollowHandlers,
    onOpen: () => void,
    signal: AbortSignal,
  ): Promise<LogStreamEnd> {
    return new Promise<LogStreamEnd>((resolve, reject) => {
      const stream = this.openTail({ filter });

      let opened = false;
      const open = (): void => {
        if (!opened) {
          opened = true;
          clearTimeout(openTimer);
          onOpen();
        }
      };
      const openTimer = setTimeout(open, GCP_LOGS_TAIL_OPEN_AFTER_MS);

      let settled = false;
      const settle = (end: LogStreamEnd | Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(openTimer);
        signal.removeEventListener('abort', onAbort);
        if (end instanceof Error) {
          reject(end);
        } else {
          resolve(end);
        }
      };
      const onAbort = (): void => {
        settle('dropped');
        (stream as Duplex & { abort?: () => void }).abort?.();
        stream.destroy();
      };
      signal.addEventListener('abort', onAbort, { once: true });

      stream.on('data', (response: GcpTailResponse) => {
        if (settled) {
          return;
        }
        open();
        const entries = (response.entries ?? []).map((entry) =>
          this.normalize(toGcpRestLogEntry(entry), sources),
        );
        if (entries.length > 0) {
          handlers.onEntries(entries);
        }
        for (const text of formatGcpTailSuppression(response.suppressionInfo)) {
          handlers.onNotice(text);
        }
      });
      stream.on('error', (error: unknown) => {
        settle(signal.aborted ? 'dropped' : this.tailError(error));
      });
      stream.on('end', () => settle('dropped'));
      stream.on('close', () => settle('dropped'));
    });
  }

  private openTail(request: GcpTailRequest): Duplex {
    if (this.params.tail) {
      return this.params.tail(request);
    }
    const { buildGCPClientOptions } = getContext();
    this.tailClient ??= new Logging(
      buildGCPClientOptions(this.params.credentials),
    );
    return this.tailClient.tailEntries(request);
  }

  /** A tail stream's error, with a hint where one helps */
  private tailError(error: unknown): Error {
    const { CliError } = getContext();
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown } | undefined)?.code;

    // gRPC codes: 7 permission denied, 8 resource exhausted
    if (code === 7) {
      return new CliError(
        `Cannot follow Cloud Logging: ${message}`,
        'infra:logs --follow',
        `The deploy account needs the Logs Viewer role (roles/logging.viewer). Run npx tsdevstack infra:bootstrap --env ${this.params.targetEnv} to add it.`,
      );
    }
    if (code === 8) {
      return new CliError(
        `Cannot follow Cloud Logging: ${message}`,
        'infra:logs --follow',
        "Google allows 10 live log streams at once per project, the Logs Explorer's live mode included. Close one and run the command again.",
      );
    }
    return new CliError(
      `Cannot follow Cloud Logging: ${message}`,
      'infra:logs --follow',
    );
  }
}
