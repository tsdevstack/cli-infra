/**
 * --follow for one Container App (a service or a worker).
 *
 * - Its output: Azure streams it one replica container at a time, so the
 *   app's running containers are checked every
 *   AZURE_LOGS_FOLLOW_REPLICA_CHECK_MS and each new one gets its own stream.
 *   Containers running when the command starts show new lines only; one
 *   that starts later shows from its first line (up to
 *   AZURE_LOG_STREAM_NEW_REPLICA_TAIL_LINES earlier lines). A stream that
 *   ends because its replica stopped ends quietly; one that drops is opened
 *   again (followLogStream). A stream that can't open yet (the replica is
 *   still starting) is tried again at the next check, with a note; a
 *   refused sign-in, or a stream that gives up, stops the command.
 * - Its system events: the app's event stream.
 *
 * Both streams sign in with the app's log stream token (getAuthToken).
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { getContext } from '../../../context';
import {
  AZURE_LOG_STREAM_NEW_REPLICA_TAIL_LINES,
  AZURE_LOGS_FOLLOW_REPLICA_CHECK_MS,
} from '../../../constants';
import { followLogStream } from '../../logs/follow-log-stream';
import type {
  LogSource,
  LogsFollowHandlers,
  LogStreamEnd,
} from '../../logs/types';
import { listAzureRunningContainers } from './list-azure-running-containers';
import { parseAzureConsoleStreamLine } from './parse-azure-console-stream-line';
import { parseAzureSystemStreamLine } from './parse-azure-system-stream-line';
import { streamHttpLines } from './stream-http-lines';
import type { AzureContainerAppsClient, AzureReplicaContainer } from './types';

interface AzureAppFollowerParams {
  source: LogSource;
  /** The Container App's name (`{project}-{name}`) */
  app: string;
  resourceGroup: string;
  client: AzureContainerAppsClient;
  handlers: LogsFollowHandlers;
  signal: AbortSignal;
  /** For tests */
  fetchFn?: typeof fetch;
  checkIntervalMs?: number;
  reconnectDelayMs?: number;
}

/** Refresh the stream token this long before it expires */
const TOKEN_MARGIN_MS = 60_000;

export class AzureAppFollower {
  /** Containers with a stream, by key */
  private readonly following = new Set<string>();
  /** Containers whose stream couldn't open yet: the tail lines to open with */
  private readonly retryTailLines = new Map<string, number>();
  private readonly streams: Promise<void>[] = [];
  private checkedOnce = false;
  private token: { value: string; expires: number } | undefined;
  /** Rejects when a container's stream gives up: the command stops */
  private readonly failure: Promise<never>;
  private fail: (error: unknown) => void = () => undefined;

  constructor(private readonly params: AzureAppFollowerParams) {
    this.failure = new Promise<never>((_resolve, reject) => {
      this.fail = reject;
    });
    // Handled in follow(); without this Node reports it as unhandled first
    this.failure.catch(() => undefined);
  }

  /** Follow until the signal aborts: the output, the events, or both */
  async follow(what: { output: boolean; events: boolean }): Promise<void> {
    const { source, signal, handlers } = this.params;
    const tasks: Promise<void>[] = [];

    if (what.output) {
      tasks.push(
        followLogStream({
          name: `${source.name} (replicas)`,
          open: (onOpen, streamSignal) =>
            this.checkContainers(onOpen, streamSignal),
          signal,
          notice: handlers.onNotice,
          ...this.delay(),
        }),
      );
    }
    if (what.events) {
      tasks.push(
        followLogStream({
          name: `${source.name} (events)`,
          open: (onOpen, streamSignal) => this.openEvents(onOpen, streamSignal),
          signal,
          notice: handlers.onNotice,
          ...this.delay(),
        }),
      );
    }

    await Promise.race([Promise.all(tasks), this.failure]);
    await Promise.race([Promise.all(this.streams), this.failure]);
  }

  /** Check the running containers until the signal aborts; stream new ones */
  private async checkContainers(
    onOpen: () => void,
    signal: AbortSignal,
  ): Promise<LogStreamEnd> {
    const intervalMs =
      this.params.checkIntervalMs ?? AZURE_LOGS_FOLLOW_REPLICA_CHECK_MS;

    let opened = false;
    while (!signal.aborted) {
      const containers = await this.listContainers();
      if (!opened) {
        opened = true;
        onOpen();
      }

      for (const container of containers) {
        if (this.following.has(container.key)) {
          continue;
        }
        this.following.add(container.key);
        const tailLines =
          this.retryTailLines.get(container.key) ??
          (this.checkedOnce ? AZURE_LOG_STREAM_NEW_REPLICA_TAIL_LINES : 0);
        this.retryTailLines.delete(container.key);
        this.streams.push(
          this.followContainer(container, tailLines)
            .catch((error: unknown) => this.fail(error))
            .finally(() => this.following.delete(container.key)),
        );
      }
      this.checkedOnce = true;

      try {
        await sleep(intervalMs, undefined, { signal });
      } catch {
        break;
      }
    }
    return 'dropped';
  }

  /** One container's output: the first open with `tailLines`, reopens with none */
  private followContainer(
    container: AzureReplicaContainer,
    tailLines: number,
  ): Promise<void> {
    const { source, signal, handlers } = this.params;
    let opened = false;
    return followLogStream({
      name: `${source.name} (${container.replica})`,
      open: (onOpen, streamSignal) =>
        this.openContainer(
          container,
          opened ? 0 : tailLines,
          () => {
            opened = true;
            onOpen();
          },
          streamSignal,
          opened,
        ),
      signal,
      notice: handlers.onNotice,
      ...this.delay(),
    });
  }

  private async openContainer(
    container: AzureReplicaContainer,
    tailLines: number,
    onOpen: () => void,
    signal: AbortSignal,
    /** Whether this stream was open before (a reconnect) */
    openedBefore: boolean,
  ): Promise<LogStreamEnd> {
    const { source, handlers } = this.params;
    try {
      const url = new URL(container.logStreamEndpoint);
      url.searchParams.set('follow', 'true');
      url.searchParams.set('tailLines', String(tailLines));
      url.searchParams.set('output', 'json');
      await streamHttpLines({
        url: url.toString(),
        headers: { Authorization: `Bearer ${await this.streamToken()}` },
        signal,
        onOpen,
        onLine: (line) => {
          const entry = parseAzureConsoleStreamLine(line, source, new Date());
          if (entry) {
            handlers.onEntries([entry]);
          }
        },
        ...(this.params.fetchFn && { fetchFn: this.params.fetchFn }),
      });
    } catch (error) {
      if (signal.aborted) {
        return 'dropped';
      }
      const failure = this.streamError(error);
      if (this.isSignInRefused(error)) {
        throw failure;
      }
      // A replica that stopped takes its stream with it
      if (!(await this.isRunning(container))) {
        return 'ended';
      }
      if (!openedBefore) {
        handlers.onNotice(
          `Cannot open the stream of ${source.name} (${container.replica}) yet: ${error instanceof Error ? error.message : String(error)}. Trying again at the next check.`,
        );
        this.retryTailLines.set(container.key, tailLines);
        return 'ended';
      }
      throw failure;
    }
    if (signal.aborted) {
      return 'dropped';
    }
    return (await this.isRunning(container)) ? 'dropped' : 'ended';
  }

  private async openEvents(
    onOpen: () => void,
    signal: AbortSignal,
  ): Promise<LogStreamEnd> {
    const { source, app, resourceGroup, client, handlers } = this.params;
    try {
      const containerApp = await client.containerApps.get(resourceGroup, app);
      if (!containerApp.eventStreamEndpoint) {
        return 'ended';
      }
      const url = new URL(containerApp.eventStreamEndpoint);
      url.searchParams.set('follow', 'true');
      url.searchParams.set('tailLines', '0');
      await streamHttpLines({
        url: url.toString(),
        headers: { Authorization: `Bearer ${await this.streamToken()}` },
        signal,
        onOpen,
        onLine: (line) => {
          const entry = parseAzureSystemStreamLine(line, source, new Date());
          if (entry) {
            handlers.onEntries([entry]);
          }
        },
        ...(this.params.fetchFn && { fetchFn: this.params.fetchFn }),
      });
    } catch (error) {
      if (signal.aborted) {
        return 'dropped';
      }
      throw this.streamError(error);
    }
    return 'dropped';
  }

  private async listContainers(): Promise<AzureReplicaContainer[]> {
    const { app, resourceGroup, client } = this.params;
    try {
      return await listAzureRunningContainers(client, resourceGroup, app);
    } catch (error) {
      throw this.streamError(error);
    }
  }

  private async isRunning(container: AzureReplicaContainer): Promise<boolean> {
    const containers = await this.listContainers();
    return containers.some((running) => running.key === container.key);
  }

  /** The app's log stream token, fetched again shortly before it expires */
  private async streamToken(): Promise<string> {
    if (this.token && this.token.expires - TOKEN_MARGIN_MS > Date.now()) {
      return this.token.value;
    }
    const { app, resourceGroup, client } = this.params;
    const { CliError } = getContext();
    const response = await client.containerApps.getAuthToken(
      resourceGroup,
      app,
    );
    if (!response.token) {
      throw new CliError(
        `Azure gave no log stream token for ${app}`,
        'infra:logs --follow',
      );
    }
    this.token = {
      value: response.token,
      expires: response.expires?.getTime() ?? Date.now() + TOKEN_MARGIN_MS,
    };
    return response.token;
  }

  /** A 401 or 403, from Azure's API or the stream */
  private isSignInRefused(error: unknown): boolean {
    const failure = error as
      { status?: unknown; statusCode?: unknown } | undefined;
    const status = failure?.status ?? failure?.statusCode;
    return status === 401 || status === 403;
  }

  private streamError(error: unknown): Error {
    const { CliError } = getContext();
    if (error instanceof CliError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new CliError(
      `Cannot follow ${this.params.app}: ${message}`,
      'infra:logs --follow',
      this.isSignInRefused(error)
        ? "The deploy credentials need to read the Container App's log stream (Microsoft.App/containerApps/getAuthToken/action, in Contributor)."
        : undefined,
    );
  }

  /** The reconnect delay, for tests */
  private delay(): { delayMs?: number } {
    return this.params.reconnectDelayMs !== undefined
      ? { delayMs: this.params.reconnectDelayMs }
      : {};
  }
}
