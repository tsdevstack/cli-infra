/**
 * Why a save of a database failed, in a few lines
 */

import { DB_EXPORT_FAILURE_LINES } from '../../constants';

/**
 * The error's message, then the end of the job's output (a CliError's
 * hint holds the job's logs)
 *
 * @param error - What the cloud's save threw
 * @returns The message first, then up to DB_EXPORT_FAILURE_LINES lines
 */
export function describeSaveFailure(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  const hint = (error as { hint?: unknown } | null)?.hint;
  const output =
    typeof hint === 'string'
      ? hint
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-DB_EXPORT_FAILURE_LINES)
      : [];
  return [message, ...output];
}
