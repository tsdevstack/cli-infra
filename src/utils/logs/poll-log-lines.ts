/**
 * Lines for --follow from a source that has no live stream, asked for every
 * `intervalMs`: ECS's platform lines on AWS, the Log Analytics lines on
 * Azure (jobs, App Service, buckets, edge).
 *
 * Each check looks `overlapMs` back past the previous one, for lines that
 * show up late (ECS events, Log Analytics' 1 to 10 minutes); lines already
 * printed are skipped. Nothing from before the command started. Open after
 * the first check; an error ends it (followLogStream tries again).
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { LogEntry, LogStreamEnd } from './types';

export async function pollLogLines(params: {
  /** The lines between two times */
  list: (since: Date, until: Date) => Promise<LogEntry[]>;
  onEntries: (entries: LogEntry[]) => void;
  onOpen: () => void;
  signal: AbortSignal;
  /** Lines from this time on (when the command started) */
  start: Date;
  intervalMs: number;
  overlapMs: number;
  /** For tests */
  now?: () => Date;
}): Promise<LogStreamEnd> {
  const { list, onEntries, onOpen, signal, start, intervalMs, overlapMs } =
    params;
  const now = params.now ?? (() => new Date());

  /** Printed lines and their time, to skip them in the next check */
  const printed = new Map<string, number>();
  let checkedUntil = start.getTime();
  let opened = false;

  while (!signal.aborted) {
    const until = now();
    const since = new Date(Math.max(start.getTime(), checkedUntil - overlapMs));
    const entries = await list(since, until);
    if (signal.aborted) {
      break;
    }
    if (!opened) {
      opened = true;
      onOpen();
    }

    const fresh = entries.filter((entry) => {
      const key = `${entry.time}|${entry.source}|${entry.message}`;
      if (printed.has(key)) {
        return false;
      }
      printed.set(key, Date.parse(entry.time));
      return true;
    });
    if (fresh.length > 0) {
      onEntries(fresh);
    }

    // Lines older than the next check's start can't come back
    checkedUntil = until.getTime();
    for (const [key, time] of printed) {
      if (time < checkedUntil - overlapMs) {
        printed.delete(key);
      }
    }

    try {
      await sleep(intervalMs, undefined, { signal });
    } catch {
      break;
    }
  }
  return 'dropped';
}
