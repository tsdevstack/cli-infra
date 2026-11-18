/**
 * Keep one live log stream open for --follow, on every provider.
 *
 * - The first open fails at once: a stream that never opened has a cause
 *   that trying again won't fix (permissions, a missing resource).
 * - After that, a stream that drops (an error, or the cloud closing it) is
 *   opened again, a few seconds later. Each reconnect says so in one line,
 *   since lines written in between may be missing.
 * - After LOGS_FOLLOW_RECONNECT_TRIES tries in a row that don't open, the
 *   last error stops the command.
 * - A stream that ends because what it followed is gone (`ended`) stops
 *   quietly. So does an aborted signal (Ctrl+C, the time limit).
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { getContext } from '../../context';
import {
  LOGS_FOLLOW_RECONNECT_DELAY_MS,
  LOGS_FOLLOW_RECONNECT_TRIES,
} from '../../constants';
import type { LogStreamEnd } from './types';

interface FollowLogStreamParams {
  /** What the stream follows, for the reconnect line (a source name, or a list) */
  name: string;
  /**
   * Open the stream and read it: call onOpen once it is connected, resolve
   * when it ends, reject on an error. Stop when the signal aborts.
   */
  open: (onOpen: () => void, signal: AbortSignal) => Promise<LogStreamEnd>;
  signal: AbortSignal;
  notice: (text: string) => void;
  /** For tests */
  delayMs?: number;
}

export async function followLogStream(
  params: FollowLogStreamParams,
): Promise<void> {
  const { CliError } = getContext();
  const { name, open, signal, notice } = params;
  const delayMs = params.delayMs ?? LOGS_FOLLOW_RECONNECT_DELAY_MS;

  let everOpened = false;
  let failedTries = 0;

  while (!signal.aborted) {
    let opened = false;
    let end: LogStreamEnd = 'dropped';
    let lastError: unknown;
    try {
      end = await open(() => {
        opened = true;
        failedTries = 0;
        if (everOpened) {
          notice(
            `Reconnected to ${name}. Lines written in between may be missing.`,
          );
        }
        everOpened = true;
      }, signal);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      if (!everOpened) {
        throw error;
      }
      lastError = error;
    }

    if (signal.aborted || end === 'ended') {
      return;
    }

    if (!opened) {
      failedTries += 1;
      if (failedTries >= LOGS_FOLLOW_RECONNECT_TRIES || !everOpened) {
        throw (
          lastError ??
          new CliError(
            `Cannot open the live stream for ${name}`,
            'infra:logs --follow',
          )
        );
      }
    }

    try {
      await sleep(delayMs, undefined, { signal });
    } catch {
      // Aborted while waiting
      return;
    }
  }
}
