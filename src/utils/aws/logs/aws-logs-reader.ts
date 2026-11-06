/**
 * AWS Logs Reader
 *
 * App, job and edge lines come from CloudWatch Logs (FilterLogEvents: free,
 * one read per log group, merged into one timeline); platform lines from
 * ECS. --grep is checked here, not by CloudWatch, whose matching is
 * case-sensitive.
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
  AWS_LOGS_CONCURRENCY,
  AWS_LOGS_NEWEST_FIRST_EARLIEST,
  AWS_LOGS_PAGE_SIZE,
  LOG_SOURCE_LIST_WINDOW_DAYS,
} from '../../../constants';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { matchesLogFilters } from '../../logs/matches-log-filters';
import { mergeSortedLogPages } from '../../logs/merge-sorted-log-pages';
import type {
  LogEntry,
  LogSource,
  LogSourceLastLogged,
  LogsQuery,
  LogsReader,
  NewestLogsResult,
} from '../../logs/types';
import { buildAwsLogGroupReads } from './build-aws-log-group-reads';
import { listAwsEcsPlatformEntries } from './list-aws-ecs-platform-entries';
import { parseAwsAppEvent } from './parse-aws-app-event';
import { parseAwsJobEvent } from './parse-aws-job-event';
import { parseAwsWafEvent } from './parse-aws-waf-event';
import type { AwsLogGroupRead } from './types';

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
        const [read] = this.reads({ sources: [source], since, until: now });
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

  private reads(query: LogsQuery): AwsLogGroupRead[] {
    return buildAwsLogGroupReads(query.sources, {
      projectName: this.params.projectName,
      targetEnv: this.params.targetEnv,
      region: this.params.credentials.region,
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
    const { CliError } = getContext();

    let entries: LogEntry[];
    try {
      entries = await listAwsEcsPlatformEntries({
        ecs: this.ecs,
        clusterName: `${this.params.projectName}${AWS_ECS_CLUSTER_SUFFIX}`,
        sources: query.sources,
        since: query.since,
        until: query.until,
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

    const ordered = direction === 'asc' ? entries : [...entries].reverse();
    const single = (async function* (): AsyncGenerator<LogEntry[]> {
      yield ordered;
    })();
    return [single];
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
              : parseAwsAppEvent(event, read.source);
        if (entry) {
          entries.push(entry);
        }
      }
      yield entries;

      nextToken = response.nextToken;
    } while (nextToken);
  }
}
