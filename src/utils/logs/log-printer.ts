/**
 * Log Printer
 *
 * Writes lines to standard output as they arrive, one per entry: the
 * terminal format, or one JSON object per line (--json). Every line is
 * checked against the filters first, so all providers show the same lines.
 */

import { formatLogLine } from './format-log-line';
import { matchesLogFilters } from './matches-log-filters';
import type { LogEntry, LogsQuery } from './types';

export interface LogPrinterOptions {
  json: boolean;
  /** --json: add the provider's own record under `raw` */
  raw: boolean;
  /** Terminal colors */
  color: boolean;
  /** Width of the source column (the longest selected source name) */
  sourceWidth: number;
  filters: Pick<LogsQuery, 'level' | 'kind' | 'grep'>;
  write?: (text: string) => void;
}

export class LogPrinter {
  private printedCount = 0;
  private readonly write: (text: string) => void;

  constructor(private readonly options: LogPrinterOptions) {
    this.write =
      options.write ?? ((text: string) => process.stdout.write(text));
  }

  /** Lines written so far */
  get printed(): number {
    return this.printedCount;
  }

  print(entries: LogEntry[]): void {
    const lines: string[] = [];

    for (const entry of entries) {
      if (!matchesLogFilters(entry, this.options.filters)) {
        continue;
      }

      if (this.options.json) {
        const { raw, ...rest } = entry;
        lines.push(JSON.stringify(this.options.raw ? { ...rest, raw } : rest));
      } else {
        lines.push(
          formatLogLine(entry, this.options.sourceWidth, this.options.color),
        );
      }
    }

    if (lines.length > 0) {
      this.write(`${lines.join('\n')}\n`);
      this.printedCount += lines.length;
    }
  }
}
