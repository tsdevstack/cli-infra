/**
 * Run a provider's follow session for infra:logs --follow: print new lines
 * as they arrive until Ctrl+C, or until the time limit
 * (LOGS_FOLLOW_TIME_LIMIT_HOURS) unless --no-time-limit. Notices go to
 * standard error.
 */

import { LOGS_FOLLOW_TIME_LIMIT_HOURS } from '../../constants';
import { listenForInterrupt } from './listen-for-interrupt';
import type { LogPrinter } from './log-printer';
import type { LogsFollowQuery, LogsReader } from './types';

interface FollowLogsParams {
  follow: LogsReader['follow'];
  query: LogsFollowQuery;
  printer: LogPrinter;
  notice: (text: string) => void;
  /** False with --no-time-limit */
  timeLimit: boolean;
  /** For tests */
  timeLimitMs?: number;
  /** For tests: Ctrl+C */
  onInterrupt?: (stop: () => void) => () => void;
}

export async function followLogs(params: FollowLogsParams): Promise<void> {
  const { follow, query, printer, notice, timeLimit } = params;
  const hours = LOGS_FOLLOW_TIME_LIMIT_HOURS;
  const limitText = `${hours} hour${hours === 1 ? '' : 's'}`;
  const timeLimitMs = params.timeLimitMs ?? hours * 60 * 60 * 1000;

  const controller = new AbortController();
  let timedOut = false;

  const stopListening = (params.onInterrupt ?? listenForInterrupt)(() =>
    controller.abort(),
  );
  const timer = timeLimit
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeLimitMs)
    : undefined;

  try {
    await follow(
      query,
      {
        onEntries: (entries) => printer.print(entries),
        onNotice: notice,
      },
      controller.signal,
    );
  } catch (error) {
    // A stream that throws while closing on Ctrl+C or the time limit
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timer);
    stopListening();
    controller.abort();
  }

  if (printer.printed === 0) {
    notice('No new lines.');
  }
  if (timedOut) {
    notice(
      `Stopped after ${limitText}. Run the command again to keep following, or add --no-time-limit.`,
    );
  }
}
