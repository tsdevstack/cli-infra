/**
 * Run infra:logs with a provider's reader
 *
 * - No source and no --all: list the sources and when each last logged.
 * - A source or --all: print every line of the window, oldest first, as
 *   pages arrive. There is no cap; filters narrow the output.
 * - --newest <n> (MCP get_logs): only the newest n lines, and what was left out.
 *
 * Lines go to standard output; the header and notices go to standard error,
 * so --json output stays clean.
 */

import { getContext } from '../../context';
import { DEFAULT_LOGS_SINCE, LOG_KINDS, LOG_LEVELS } from '../../constants';
import { LogPrinter } from './log-printer';
import { parseLogOption } from './parse-log-option';
import { parseLogTime } from './parse-log-time';
import { printLogSources } from './print-log-sources';
import { selectLogSources } from './select-log-sources';
import type {
  InfraLogsOptions,
  LogSource,
  LogsQuery,
  LogsReader,
} from './types';

interface RunLogsCommandParams {
  reader: LogsReader;
  sourceName: string | undefined;
  options: InfraLogsOptions;
  targetEnv: string;
  sources: LogSource[];
  now: Date;
  /** Standard output (lines) */
  write?: (text: string) => void;
  /** Standard error (header and notices) */
  notice?: (text: string) => void;
}

export async function runLogsCommand(
  params: RunLogsCommandParams,
): Promise<void> {
  const { CliError } = getContext();
  const { reader, sourceName, options, targetEnv, sources, now } = params;
  const write = params.write ?? ((text: string) => process.stdout.write(text));
  const notice =
    params.notice ?? ((text: string) => process.stderr.write(`${text}\n`));
  const json = options.json ?? false;

  if (sourceName && options.all) {
    throw new CliError(
      'Name a source or use --all, not both',
      'infra:logs',
      `npx tsdevstack infra:logs ${sourceName} --env ${targetEnv}`,
    );
  }

  // Source list
  if (!sourceName && !options.all) {
    const results = await reader.lastLogged(sources, now);
    printLogSources(results, targetEnv, json, write);
    return;
  }

  const selected = selectLogSources(sources, sourceName);
  const since = parseLogTime(options.since ?? DEFAULT_LOGS_SINCE, now);
  const until = options.until ? parseLogTime(options.until, now) : now;
  if (since >= until) {
    throw new CliError(
      'The time window is empty: --since must be before --until',
      'infra:logs',
    );
  }

  const query: LogsQuery = {
    sources: selected,
    since,
    until,
    ...(options.level && {
      level: parseLogOption('--level', options.level, LOG_LEVELS),
    }),
    ...(options.kind && {
      kind: parseLogOption('--kind', options.kind, LOG_KINDS),
    }),
    ...(options.grep && { grep: options.grep }),
  };

  let newest: number | undefined;
  if (options.newest !== undefined) {
    newest = Number(options.newest);
    if (!Number.isInteger(newest) || newest < 1) {
      throw new CliError(
        `Invalid --newest: ${options.newest}`,
        'infra:logs',
        'Use a whole number above 0',
      );
    }
  }

  const printer = new LogPrinter({
    json,
    raw: options.raw ?? true,
    color: !json && process.stdout.isTTY === true && !process.env.NO_COLOR,
    sourceWidth: Math.max(...selected.map((source) => source.name.length)),
    filters: query,
    write,
  });

  const formatTime = (date: Date): string =>
    date
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');
  const what = sourceName ?? 'all sources';
  notice(
    `${what} in ${targetEnv}, ${formatTime(since)} to ${formatTime(until)} (times in UTC)`,
  );
  if (query.level) {
    notice(
      `--level leaves out lines without a level (Kong, frontends, other plain text).`,
    );
  }

  if (newest !== undefined) {
    const result = await reader.readNewest(query, newest);
    printer.print(result.entries);
    if (result.more) {
      const first = result.entries[0];
      const last = result.entries[result.entries.length - 1];
      const leftOut =
        result.total !== undefined
          ? `${result.total - result.entries.length} lines`
          : 'Lines';
      notice(
        `Showing the newest ${result.entries.length} lines (${formatTime(new Date(first.time))} to ${formatTime(new Date(last.time))}). ${leftOut} between ${formatTime(since)} and ${formatTime(new Date(first.time))} were left out. Narrow the query with --since, --level, --grep or --kind.`,
      );
    } else if (printer.printed === 0) {
      notice('No lines in this window.');
    }
    return;
  }

  await reader.read(query, (entries) => printer.print(entries));
  if (printer.printed === 0) {
    notice('No lines in this window.');
  }
}
