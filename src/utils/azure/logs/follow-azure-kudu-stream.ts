/**
 * --follow for one App Service app (Kong, a Next.js app): its Kudu site's
 * log stream, signed in with an App Service token of the environment's
 * credentials (AZURE_KUDU_LOG_SOURCE_TYPES has the why).
 *
 * - Kudu first replays the last 10 lines of each log file, then sends new
 *   lines (AZURE_KUDU_LIVE_MARKER). The first stream shows new lines only,
 *   like a service's. When Kudu closes the stream (it does, now and then)
 *   it is opened again, and the replayed lines newer than the last line
 *   shown fill the gap (up to 10 per file).
 * - Lines: parseAzureKuduStreamLine (the app's output, App Service's
 *   events; Kudu's own lines left out). The stream doesn't say which
 *   instance a line comes from.
 * - A refused sign-in (401, 403) stops the command with what's missing.
 */

import type { TokenCredential } from '@azure/identity';
import { getContext } from '../../../context';
import {
  AZURE_KUDU_HOST_SUFFIX,
  AZURE_KUDU_LIVE_MARKER,
  AZURE_KUDU_LOG_STREAM_PATH,
  AZURE_KUDU_TOKEN_SCOPE,
} from '../../../constants';
import { followLogStream } from '../../logs/follow-log-stream';
import type {
  LogEntry,
  LogSource,
  LogsFollowHandlers,
  LogStreamEnd,
} from '../../logs/types';
import { parseAzureKuduStreamLine } from './parse-azure-kudu-stream-line';
import { streamHttpLines } from './stream-http-lines';

interface FollowAzureKuduStreamParams {
  source: LogSource;
  /** The App Service app's name */
  app: string;
  credential: Pick<TokenCredential, 'getToken'>;
  handlers: LogsFollowHandlers;
  signal: AbortSignal;
  /** For tests */
  fetchFn?: typeof fetch;
  reconnectDelayMs?: number;
}

export async function followAzureKuduStream(
  params: FollowAzureKuduStreamParams,
): Promise<void> {
  const { CliError } = getContext();
  const { source, app, credential, handlers, signal } = params;

  // The newest line shown, and the lines shown at that time (a replay
  // repeats them)
  let newest = '';
  let shownAtNewest = new Set<string>();
  let openedBefore = false;

  const show = (entry: LogEntry): void => {
    if (entry.time > newest) {
      newest = entry.time;
      shownAtNewest = new Set();
    }
    shownAtNewest.add(String(entry.raw));
    handlers.onEntries([entry]);
  };

  const open = async (
    onOpen: () => void,
    streamSignal: AbortSignal,
  ): Promise<LogStreamEnd> => {
    const replayFills = openedBefore;
    let live = false;
    try {
      const token = await credential.getToken(AZURE_KUDU_TOKEN_SCOPE);
      if (!token) {
        throw new CliError(
          `Azure gave no App Service token for ${app}`,
          'infra:logs --follow',
        );
      }
      await streamHttpLines({
        url: `https://${app}${AZURE_KUDU_HOST_SUFFIX}${AZURE_KUDU_LOG_STREAM_PATH}`,
        headers: { Authorization: `Bearer ${token.token}` },
        signal: streamSignal,
        onOpen: () => {
          openedBefore = true;
          onOpen();
        },
        onLine: (line) => {
          if (!live && AZURE_KUDU_LIVE_MARKER.test(line)) {
            live = true;
            return;
          }
          const entry = parseAzureKuduStreamLine(line, source);
          if (!entry) {
            return;
          }
          if (live) {
            show(entry);
          } else if (
            replayFills &&
            (entry.time > newest ||
              (entry.time === newest && !shownAtNewest.has(String(entry.raw))))
          ) {
            show(entry);
          }
        },
        ...(params.fetchFn && { fetchFn: params.fetchFn }),
      });
    } catch (error) {
      if (streamSignal.aborted) {
        return 'dropped';
      }
      if (error instanceof CliError) {
        throw error;
      }
      const status = (error as { status?: unknown } | undefined)?.status;
      const refused = status === 401 || status === 403;
      throw new CliError(
        `Cannot follow ${source.name} (${app}): ${error instanceof Error ? error.message : String(error)}`,
        'infra:logs --follow',
        refused
          ? 'The deploy credentials need publish rights on the App Service app (Microsoft.Web/sites/publish/Action, in Contributor or Website Contributor).'
          : undefined,
      );
    }
    // Kudu closed the stream: open it again
    return 'dropped';
  };

  await followLogStream({
    name: source.name,
    open,
    signal,
    notice: handlers.onNotice,
    ...(params.reconnectDelayMs !== undefined && {
      delayMs: params.reconnectDelayMs,
    }),
  });
}
