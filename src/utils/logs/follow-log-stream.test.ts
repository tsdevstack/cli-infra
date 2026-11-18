import { describe, it, expect, rs, beforeEach } from '@rstest/core';

class MockCliError extends Error {
  constructor(
    message: string,
    public context?: string,
    public hint?: string,
  ) {
    super(message);
  }
}
rs.mock('../../context', () => ({
  getContext: () => ({ CliError: MockCliError }),
}));

import { followLogStream } from './follow-log-stream';
import type { LogStreamEnd } from './types';

type Attempt = (
  onOpen: () => void,
  signal: AbortSignal,
) => Promise<LogStreamEnd>;

/** One scripted result per open, in order */
function scripted(attempts: Attempt[]) {
  return rs.fn<Attempt>((onOpen, signal) => {
    const next = attempts.shift();
    if (!next) {
      throw new Error('No more attempts scripted');
    }
    return next(onOpen, signal);
  });
}

const opens = (end: LogStreamEnd): Attempt => {
  return async (onOpen) => {
    onOpen();
    return end;
  };
};
const failsToOpen = (message: string): Attempt => {
  return async () => {
    throw new Error(message);
  };
};
const opensThenFails = (message: string): Attempt => {
  return async (onOpen) => {
    onOpen();
    throw new Error(message);
  };
};

const notice = rs.fn();

describe('followLogStream', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should stop quietly when the stream ends because its source is gone', async () => {
      const open = scripted([opens('ended')]);

      await followLogStream({
        name: 'auth-service',
        open,
        signal: new AbortController().signal,
        notice,
        delayMs: 0,
      });

      expect(open).toHaveBeenCalledTimes(1);
      expect(notice).not.toHaveBeenCalled();
    });

    it('should open a dropped stream again and say lines may be missing', async () => {
      const open = scripted([
        opens('dropped'),
        opensThenFails('connection reset'),
        opens('ended'),
      ]);

      await followLogStream({
        name: 'auth-service',
        open,
        signal: new AbortController().signal,
        notice,
        delayMs: 0,
      });

      expect(open).toHaveBeenCalledTimes(3);
      expect(notice.mock.calls).toEqual([
        [
          'Reconnected to auth-service. Lines written in between may be missing.',
        ],
        [
          'Reconnected to auth-service. Lines written in between may be missing.',
        ],
      ]);
    });

    it('should keep trying after a drop and count from zero again once it reconnects', async () => {
      const open = scripted([
        opens('dropped'),
        failsToOpen('unavailable'),
        failsToOpen('unavailable'),
        opens('dropped'),
        failsToOpen('unavailable'),
        failsToOpen('unavailable'),
        opens('ended'),
      ]);

      await followLogStream({
        name: 'kong',
        open,
        signal: new AbortController().signal,
        notice,
        delayMs: 0,
      });

      expect(open).toHaveBeenCalledTimes(7);
      expect(notice).toHaveBeenCalledTimes(2);
    });

    it('should stop when the signal aborts while the stream is open', async () => {
      const controller = new AbortController();
      const open = scripted([
        (onOpen, signal) =>
          new Promise<LogStreamEnd>((resolve) => {
            onOpen();
            signal.addEventListener('abort', () => resolve('dropped'));
            controller.abort();
          }),
      ]);

      await followLogStream({
        name: 'auth-service',
        open,
        signal: controller.signal,
        notice,
        delayMs: 0,
      });

      expect(open).toHaveBeenCalledTimes(1);
      expect(notice).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should fail at once when the stream never opened', async () => {
      const open = scripted([failsToOpen('AccessDeniedException')]);

      await expect(
        followLogStream({
          name: 'auth-service',
          open,
          signal: new AbortController().signal,
          notice,
          delayMs: 0,
        }),
      ).rejects.toThrow('AccessDeniedException');
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('should give up after three tries in a row that do not open', async () => {
      const open = scripted([
        opens('dropped'),
        failsToOpen('try 1'),
        failsToOpen('try 2'),
        failsToOpen('try 3'),
      ]);

      await expect(
        followLogStream({
          name: 'auth-service',
          open,
          signal: new AbortController().signal,
          notice,
          delayMs: 0,
        }),
      ).rejects.toThrow('try 3');
      expect(open).toHaveBeenCalledTimes(4);
    });

    it('should say which stream when a try ends without opening or an error', async () => {
      const open = scripted([async () => 'dropped']);

      await expect(
        followLogStream({
          name: 'auth-service',
          open,
          signal: new AbortController().signal,
          notice,
          delayMs: 0,
        }),
      ).rejects.toThrow('Cannot open the live stream for auth-service');
    });

    it('should not report an error thrown while closing on abort', async () => {
      const controller = new AbortController();
      const open = scripted([
        async (onOpen) => {
          onOpen();
          controller.abort();
          throw new Error('stream cancelled');
        },
      ]);

      await followLogStream({
        name: 'auth-service',
        open,
        signal: controller.signal,
        notice,
        delayMs: 0,
      });

      expect(open).toHaveBeenCalledTimes(1);
    });

    it('should stop when the signal aborts while waiting to reconnect', async () => {
      const controller = new AbortController();
      const open = scripted([
        async (onOpen) => {
          onOpen();
          setTimeout(() => controller.abort(), 5);
          return 'dropped';
        },
      ]);

      await followLogStream({
        name: 'auth-service',
        open,
        signal: controller.signal,
        notice,
        delayMs: 60_000,
      });

      expect(open).toHaveBeenCalledTimes(1);
    });

    it('should not open at all when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const open = scripted([]);

      await followLogStream({
        name: 'auth-service',
        open,
        signal: controller.signal,
        notice,
        delayMs: 0,
      });

      expect(open).not.toHaveBeenCalled();
    });
  });
});
