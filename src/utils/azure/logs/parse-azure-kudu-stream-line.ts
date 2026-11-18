/**
 * Turn a live line of an App Service app's Kudu log stream into a line,
 * through the same code as the Log Analytics rows (normalizeAzureLogRow),
 * so live and read lines look the same.
 *
 * - Only lines App Service wrote to a log file count (AZURE_KUDU_LOG_LINE):
 *   Kudu's own trace, its welcome and its markers are left out, and so are
 *   the lines of Kudu's own container (AZURE_KUDU_OWN_LINES).
 * - App Service's events (AZURE_APP_SERVICE_PLATFORM_LINES) are platform
 *   lines; a `WARN  -` style prefix gives the level, otherwise words like
 *   "failed" make it an error, the rest info.
 * - Everything else is the app's output (Kong's or Next.js').
 */

import {
  AZURE_APP_SERVICE_PLATFORM_ERROR,
  AZURE_APP_SERVICE_PLATFORM_LEVEL_PREFIX,
  AZURE_APP_SERVICE_PLATFORM_LINES,
  AZURE_KUDU_LOG_LINE,
  AZURE_KUDU_OWN_LINES,
} from '../../../constants';
import type { LogEntry, LogSource } from '../../logs/types';
import { normalizeAzureLogRow } from './normalize-azure-log-row';

export function parseAzureKuduStreamLine(
  line: string,
  source: LogSource,
): LogEntry | undefined {
  const match = AZURE_KUDU_LOG_LINE.exec(line.trimEnd());
  if (!match) {
    return undefined;
  }
  const [, time, rest] = match;
  const text = (rest ?? '').trim();
  if (text === '' || AZURE_KUDU_OWN_LINES.some((own) => own.test(text))) {
    return undefined;
  }

  if (AZURE_APP_SERVICE_PLATFORM_LINES.some((event) => event.test(text))) {
    const prefix = AZURE_APP_SERVICE_PLATFORM_LEVEL_PREFIX.exec(text);
    const level = prefix
      ? prefix[1]
      : AZURE_APP_SERVICE_PLATFORM_ERROR.test(text)
        ? 'error'
        : 'info';
    return normalizeAzureLogRow({
      TimeGenerated: time,
      Source: source.name,
      Kind: 'platform',
      Level: level,
      Text: prefix ? text.slice(prefix[0].length) : text,
      Raw: line,
    });
  }

  return normalizeAzureLogRow({
    TimeGenerated: time,
    Source: source.name,
    Kind: 'app',
    Text: text,
    Raw: line,
  });
}
