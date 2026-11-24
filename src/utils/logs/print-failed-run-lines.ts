/**
 * Print a failed run's last lines the way infra:logs prints them
 *
 * infra:run-cron calls it after a run that failed, on every provider: the
 * job's newest lines since the run was started, oldest first, in the
 * terminal format of infra:logs (time in UTC, source, kind, level,
 * message). They are the lines `infra:logs <job> --since <start>` shows, so
 * when another run of the job logged in the same minutes, its lines are
 * among them.
 *
 * The clouds make a run's last lines readable some seconds after it ended,
 * so the lines are read again until the runner's last line ("cron job
 * finished", written after the run was started) is among them, a few times
 * at most. A process that was killed never writes that line: the command
 * then shows what it has and says so.
 *
 * Reading the lines never fails the command: the run's result is already
 * known, and a read that fails is reported in one line.
 */

import { CRON_FINISHED_MESSAGE, sleep } from '@tsdevstack/infra-core';
import { getContext } from '../../context';
import {
  FAILED_RUN_LOG_CLOCK_MARGIN_SECONDS,
  FAILED_RUN_LOG_LINES,
  FAILED_RUN_LOG_READ_TRIES,
  FAILED_RUN_LOG_WAIT_MS,
} from '../../constants';
import { LogPrinter } from './log-printer';
import type { LogEntry, LogSource, LogsReader } from './types';

export interface PrintFailedRunLinesParams {
  /** The provider's reader, created here so a failure to create it is caught too */
  createReader: () => LogsReader | Promise<LogsReader>;
  /** The scheduled job's log source */
  source: LogSource;
  /** When the run was started, by this machine's clock */
  startedAt: Date;
  /** For tests: the time of each read (default: the clock) */
  now?: () => Date;
  /** For tests */
  wait?: (milliseconds: number) => Promise<void>;
  /** Standard output (the lines) */
  write?: (text: string) => void;
}

export async function printFailedRunLines(
  params: PrintFailedRunLinesParams,
): Promise<void> {
  const { logger } = getContext();
  const { source, startedAt } = params;
  const marginMs = FAILED_RUN_LOG_CLOCK_MARGIN_SECONDS * 1000;

  try {
    const reader = await params.createReader();
    const wait = params.wait ?? sleep;

    // This run's last line: written after the run was started (an earlier
    // run's line can be in the window, the clock margin lets it in)
    const isLastLine = (entry: LogEntry): boolean =>
      entry.message === CRON_FINISHED_MESSAGE &&
      Date.parse(entry.time) >= startedAt.getTime();

    let entries: LogEntry[] = [];
    let complete = false;
    for (let attempt = 0; attempt < FAILED_RUN_LOG_READ_TRIES; attempt++) {
      await wait(FAILED_RUN_LOG_WAIT_MS);
      const now = params.now ? params.now() : new Date();
      const result = await reader.readNewest(
        {
          sources: [source],
          since: new Date(startedAt.getTime() - marginMs),
          until: new Date(now.getTime() + marginMs),
        },
        FAILED_RUN_LOG_LINES,
      );
      entries = result.entries;
      if (entries.some(isLastLine)) {
        complete = true;
        break;
      }
    }

    if (entries.length === 0) {
      logger.info('No log lines yet.');
      return;
    }

    new LogPrinter({
      json: false,
      raw: false,
      color: process.stdout.isTTY === true && !process.env.NO_COLOR,
      sourceWidth: Math.max(...entries.map((entry) => entry.source.length)),
      filters: {},
      ...(params.write && { write: params.write }),
    }).print(entries);

    if (!complete) {
      logger.info(
        `No "${CRON_FINISHED_MESSAGE}" line among them: the process was killed, or its last lines are not readable yet.`,
      );
    }
  } catch (error) {
    logger.warn(
      `Could not read the run's log lines: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
