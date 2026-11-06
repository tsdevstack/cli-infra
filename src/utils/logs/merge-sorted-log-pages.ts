/**
 * Merge several reads into one timeline, page by page.
 *
 * Each read hands over pages in time order (oldest first for 'asc', newest
 * first for 'desc'). A merged page holds every buffered line up to the
 * point all unfinished reads have reached, so lines come out in order while
 * each read still fetches page by page.
 */

import type { LogEntry } from './types';

export async function* mergeSortedLogPages(
  reads: AsyncIterator<LogEntry[]>[],
  direction: 'asc' | 'desc',
): AsyncGenerator<LogEntry[]> {
  const buffers: LogEntry[][] = reads.map(() => []);
  const finished: boolean[] = reads.map(() => false);
  // ISO 8601 UTC times sort as text
  const inOrder = (a: string, b: string): boolean =>
    direction === 'asc' ? a <= b : a >= b;

  const fill = async (index: number): Promise<void> => {
    while (!finished[index] && buffers[index].length === 0) {
      const next = await reads[index].next();
      if (next.done) {
        finished[index] = true;
      } else {
        buffers[index].push(...next.value);
      }
    }
  };

  await Promise.all(reads.map((_, index) => fill(index)));

  while (buffers.some((buffer) => buffer.length > 0)) {
    // The furthest point every unfinished read has reached
    let bound: string | undefined;
    for (let index = 0; index < reads.length; index++) {
      if (finished[index]) continue;
      const last = buffers[index][buffers[index].length - 1].time;
      if (bound === undefined || !inOrder(bound, last)) {
        bound = last;
      }
    }

    const page: LogEntry[] = [];
    for (const buffer of buffers) {
      let count = 0;
      while (
        count < buffer.length &&
        (bound === undefined || inOrder(buffer[count].time, bound))
      ) {
        count++;
      }
      page.push(...buffer.splice(0, count));
    }
    page.sort((a, b) =>
      a.time === b.time ? 0 : inOrder(a.time, b.time) ? -1 : 1,
    );

    if (page.length > 0) {
      yield page;
    }

    await Promise.all(
      reads.map((_, index) =>
        buffers[index].length === 0 ? fill(index) : Promise.resolve(),
      ),
    );
  }
}
