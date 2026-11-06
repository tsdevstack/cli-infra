import { describe, it, expect } from '@rstest/core';
import { mergeSortedLogPages } from './merge-sorted-log-pages';
import type { LogEntry } from './types';

function line(source: string, second: number): LogEntry {
  return {
    time: new Date(Date.UTC(2026, 9, 30, 12, 0, second)).toISOString(),
    source,
    kind: 'app',
    message: `${source}@${second}`,
    raw: {},
  };
}

async function* pages(...list: LogEntry[][]): AsyncGenerator<LogEntry[]> {
  for (const page of list) {
    yield page;
  }
}

async function collect(
  generator: AsyncGenerator<LogEntry[]>,
): Promise<{ pages: string[][]; all: string[] }> {
  const result: string[][] = [];
  for await (const page of generator) {
    result.push(page.map((entry) => entry.message));
  }
  return { pages: result, all: result.flat() };
}

describe('mergeSortedLogPages', () => {
  describe('Standard use cases', () => {
    it('should merge reads oldest first across pages', async () => {
      const result = await collect(
        mergeSortedLogPages(
          [
            pages([line('a', 1), line('a', 4)], [line('a', 7)]),
            pages([line('b', 2), line('b', 3), line('b', 9)]),
          ],
          'asc',
        ),
      );

      expect(result.all).toEqual(['a@1', 'b@2', 'b@3', 'a@4', 'a@7', 'b@9']);
    });

    it('should hand out lines before every read is finished', async () => {
      const result = await collect(
        mergeSortedLogPages(
          [
            pages([line('a', 1)], [line('a', 5)]),
            pages([line('b', 2)], [line('b', 6)]),
          ],
          'asc',
        ),
      );

      expect(result.pages[0]).toEqual(['a@1']);
      expect(result.all).toEqual(['a@1', 'b@2', 'a@5', 'b@6']);
    });

    it('should merge newest first', async () => {
      const result = await collect(
        mergeSortedLogPages(
          [
            pages([line('a', 8), line('a', 3)]),
            pages([line('b', 9)], [line('b', 1)]),
          ],
          'desc',
        ),
      );

      expect(result.all).toEqual(['b@9', 'a@8', 'a@3', 'b@1']);
    });
  });

  describe('Edge cases', () => {
    it('should skip empty pages and empty reads', async () => {
      const result = await collect(
        mergeSortedLogPages(
          [pages([], [line('a', 2)], []), pages(), pages([line('c', 1)])],
          'asc',
        ),
      );

      expect(result.all).toEqual(['c@1', 'a@2']);
    });

    it('should end at once with nothing to read', async () => {
      const result = await collect(mergeSortedLogPages([], 'asc'));
      expect(result.all).toEqual([]);
    });
  });
});
