/**
 * AWS Logs Reader
 *
 * App, job and edge lines come from CloudWatch Logs (FilterLogEvents: free,
 * one read per log group, merged into one timeline); platform lines from
 * ECS. --grep is checked here, not by CloudWatch, whose matching is
 * case-sensitive.
 *
 * --follow: CloudWatch Live Tail for the log groups that exist (one session
 * per region and 10 log groups, billed per minute; planAwsLiveTailSessions),
 * and ECS asked every few seconds for platform lines (pollLogLines).
 */

import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient } from '@aws-sdk/client-ecs';
import pMap from 'p-map';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import {
  AWS_ECS_CLUSTER_SUFFIX,
  AWS_ECS_SERVICE_LOG_SOURCE_TYPES,
  AWS_LOGS_CONCURRENCY,
  AWS_LOGS_FOLLOW_ECS_OVERLAP_MS,
  AWS_LOGS_FOLLOW_ECS_POLL_MS,
  AWS_LOGS_NEWEST_FIRST_EARLIEST,
  AWS_LOGS_PAGE_SIZE,
  LOG_SOURCE_LIST_WINDOW_DAYS,
} from '../../../constants';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { followLogStream } from '../../logs/follow-log-stream';
import { pollLogLines } from '../../logs/poll-log-lines';
import { matchesLogFilters } from '../../logs/matches-log-filters';
import { mergeSortedLogPages } from '../../logs/merge-sorted-log-pages';
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
import { buildAwsLogGroupReads } from './build-aws-log-group-reads';
import { listAwsEcsPlatformEntries } from './list-aws-ecs-platform-entries';
import { listAwsExistingLogGroups } from './list-aws-existing-log-groups';
import { openAwsLiveTail } from './open-aws-live-tail';
import { planAwsLiveTailSessions } from './plan-aws-live-tail-sessions';
import { parseAwsAppEvent } from './parse-aws-app-event';
import { parseAwsBucketEvent } from './parse-aws-bucket-event';
import { parseAwsJobEvent } from './parse-aws-job-event';
import { parseAwsWafEvent } from './parse-aws-waf-event';
import type {
  AwsExistingLogGroup,
  AwsLiveTailSession,
  AwsLogGroupRead,
} from './types';

interface AwsLogsReaderParams {
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
  /** For tests */
  clients?: {
    logs: (region: string) => CloudWatchLogsClient;
    ecs: ECSClient;
  };
}

export class AwsLogsReader implements LogsReader {
  private readonly logsClients = new Map<string, CloudWatchLogsClient>();
  private readonly ecs: ECSClient;

  constructor(private readonly params: AwsLogsReaderParams) {
    this.ecs =
      params.clients?.ecs ??
      new ECSClient(buildAWSClientConfig(params.credentials));
  }

  async lastLogged(
    sources: LogSource[],
    now: Date,
  ): Promise<LogSourceLastLogged[]> {
    const since = new Date(
      now.getTime() - LOG_SOURCE_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    return pMap(
      sources,
      async (source) => {
        const [read] = this.reads({ sources: [source] });
        if (!read) {
          return { source };
        }
        for await (const page of this.pages(read, since, now, 'desc')) {
          if (page.length > 0) {
            return { source, lastLogged: page[0].time };
          }
        }
        return { source };
      },
      { concurrency: AWS_LOGS_CONCURRENCY },
    );
  }

  async read(
    query: LogsQuery,
    onPage: (entries: LogEntry[]) => void,
  ): Promise<void> {
    const reads = this.reads(query).map((read) =>
      this.pages(read, query.since, query.until, 'asc'),
    );
    const platform = await this.platformPages(query, 'asc');

    for await (const page of mergeSortedLogPages(
      [...reads, ...platform],
      'asc',
    )) {
      onPage(page);
    }
  }

  async readNewest(query: LogsQuery, limit: number): Promise<NewestLogsResult> {
    const reads = this.reads(query).map((read) =>
      this.pages(read, query.since, query.until, 'desc'),
    );
    const platform = await this.platformPages(query, 'desc');

    // One line past the limit tells whether older lines were left out
    const newestFirst: LogEntry[] = [];
    for await (const page of mergeSortedLogPages(
      [...reads, ...platform],
      'desc',
    )) {
      for (const entry of page) {
        if (matchesLogFilters(entry, query)) {
          newestFirst.push(entry);
        }
      }
      if (newestFirst.length > limit) {
        break;
      }
    }

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
    const start = new Date();
    const reads = this.reads(query);

    // Live Tail fails on a log group that doesn't exist
    const existing = new Map<string, AwsExistingLogGroup>();
    for (const region of new Set(reads.map((read) => read.region))) {
      const found = await listAwsExistingLogGroups(
        this.logs(region),
        reads
          .filter((read) => read.region === region)
          .map((read) => read.logGroupName),
      );
      for (const [name, group] of found) {
        existing.set(`${region}/${name}`, group);
      }
    }
    const { sessions, notStandard } = planAwsLiveTailSessions(reads, existing);
    if (notStandard.length > 0) {
      handlers.onNotice(
        `Live Tail only follows log groups in the Standard class. Left out: ${notStandard.join(', ')}.`,
      );
    }

    const streams = sessions.map((session) =>
      followLogStream({
        name: this.sessionName(session),
        open: (onOpen, streamSignal) =>
          openAwsLiveTail({
            client: this.logs(session.region),
            session,
            handlers,
            onOpen,
            signal: streamSignal,
          }),
        signal,
        notice: handlers.onNotice,
      }),
    );

    const ecsTypes = new Set<string>([
      ...AWS_ECS_SERVICE_LOG_SOURCE_TYPES,
      'migration',
      'db-init',
    ]);
    const platformSources = query.sources.filter((source) =>
      ecsTypes.has(source.type),
    );
    if (
      platformSources.length > 0 &&
      (!query.kind || query.kind === 'platform')
    ) {
      streams.push(
        followLogStream({
          name: 'ECS events',
          open: (onOpen, streamSignal) =>
            pollLogLines({
              list: (since, until) =>
                this.listPlatform(platformSources, since, until),
              onEntries: handlers.onEntries,
              onOpen,
              signal: streamSignal,
              start,
              intervalMs: AWS_LOGS_FOLLOW_ECS_POLL_MS,
              overlapMs: AWS_LOGS_FOLLOW_ECS_OVERLAP_MS,
            }),
          signal,
          notice: handlers.onNotice,
        }),
      );
    }

    if (streams.length === 0) {
      handlers.onNotice(
        'Nothing to follow: none of the selected sources has logged yet.',
      );
      return;
    }
    if (sessions.length > 0) {
      handlers.onNotice(
        `CloudWatch Live Tail: ${sessions.length} session${sessions.length === 1 ? '' : 's'}. AWS bills each per minute after its free minutes.`,
      );
    }
    await Promise.all(streams);
  }

  /** The sources a Live Tail session follows, for the reconnect line */
  private sessionName(session: AwsLiveTailSession): string {
    const names = [...new Set(session.reads.map((read) => read.source.name))];
    return names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  }

  private reads(query: LogsFollowQuery): AwsLogGroupRead[] {
    return buildAwsLogGroupReads(query.sources, {
      projectName: this.params.projectName,
      targetEnv: this.params.targetEnv,
      region: this.params.credentials.region,
      accountId: this.params.credentials.accountId,
      kind: query.kind,
      level: query.level,
    });
  }

  private logs(region: string): CloudWatchLogsClient {
    if (this.params.clients) {
      return this.params.clients.logs(region);
    }
    let client = this.logsClients.get(region);
    if (!client) {
      client = new CloudWatchLogsClient({
        ...buildAWSClientConfig(this.params.credentials),
        region,
      });
      this.logsClients.set(region, client);
    }
    return client;
  }

  /** Platform lines from ECS, as one page (none when the kind excludes them) */
  private async platformPages(
    query: LogsQuery,
    direction: 'asc' | 'desc',
  ): Promise<AsyncIterator<LogEntry[]>[]> {
    if (query.kind && query.kind !== 'platform') {
      return [];
    }

    const entries = await this.listPlatform(
      query.sources,
      query.since,
      query.until,
    );
    if (entries.length === 0) {
      return [];
    }

    const ordered = direction === 'asc' ? entries : [...entries].reverse();
    const single = (async function* (): AsyncGenerator<LogEntry[]> {
      yield ordered;
    })();
    return [single];
  }

  /** ECS's platform lines between two times (none without a cluster) */
  private async listPlatform(
    sources: LogSource[],
    since: Date,
    until: Date,
  ): Promise<LogEntry[]> {
    const { CliError } = getContext();
    try {
      return await listAwsEcsPlatformEntries({
        ecs: this.ecs,
        projectName: this.params.projectName,
        clusterName: `${this.params.projectName}${AWS_ECS_CLUSTER_SUFFIX}`,
        sources,
        since,
        until,
      });
    } catch (error) {
      const name = (error as { name?: string } | undefined)?.name;
      if (name === 'ClusterNotFoundException') {
        return [];
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(
        `Cannot read ECS events: ${message}`,
        'infra:logs',
        name === 'AccessDeniedException'
          ? 'The deploy credentials need ecs:DescribeServices, ecs:ListTasks and ecs:DescribeTasks.'
          : undefined,
      );
    }
  }

  /** One log group's lines, page by page, in the given order */
  private async *pages(
    read: AwsLogGroupRead,
    since: Date,
    until: Date,
    direction: 'asc' | 'desc',
  ): AsyncGenerator<LogEntry[]> {
    const { CliError } = getContext();
    const client = this.logs(read.region);
    // Newest-first reads only work from 2024 on
    const startTime =
      direction === 'desc'
        ? Math.max(since.getTime(), AWS_LOGS_NEWEST_FIRST_EARLIEST)
        : since.getTime();

    let nextToken: string | undefined;
    do {
      let response;
      try {
        response = await client.send(
          new FilterLogEventsCommand({
            logGroupName: read.logGroupName,
            startTime,
            endTime: until.getTime(),
            startFromHead: direction === 'asc',
            limit: AWS_LOGS_PAGE_SIZE,
            ...(read.filterPattern && { filterPattern: read.filterPattern }),
            ...(nextToken && { nextToken }),
          }),
        );
      } catch (error) {
        const name = (error as { name?: string } | undefined)?.name;
        // No group: the source never logged (a migration that never ran)
        if (name === 'ResourceNotFoundException') {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(
          `Cannot read CloudWatch Logs (${read.logGroupName}): ${message}`,
          'infra:logs',
          name === 'AccessDeniedException'
            ? 'The deploy credentials need logs:FilterLogEvents.'
            : undefined,
        );
      }

      const entries: LogEntry[] = [];
      for (const event of response.events ?? []) {
        const entry =
          read.format === 'job'
            ? parseAwsJobEvent(event, read.source)
            : read.format === 'waf'
              ? parseAwsWafEvent(event, read.source)
              : read.format === 'bucket'
                ? parseAwsBucketEvent(event, read.source)
                : parseAwsAppEvent(event, read.source);
        if (entry) {
          entries.push(entry);
        }
      }
      // A bucket line has the request's time, while CloudWatch orders the
      // trail's records by delivery: put the page back in time order, which
      // the merge needs to move on
      if (read.format === 'bucket') {
        entries.sort((a, b) =>
          a.time === b.time
            ? 0
            : a.time < b.time === (direction === 'asc')
              ? -1
              : 1,
        );
      }
      yield entries;

      nextToken = response.nextToken;
    } while (nextToken);
  }
}
