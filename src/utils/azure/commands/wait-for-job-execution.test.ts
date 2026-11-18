/**
 * Tests for wait-for-job-execution
 */

import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import { waitForJobExecution } from './wait-for-job-execution';

const mockJobExecution = rs.fn();
const client = {
  jobExecution: mockJobExecution,
} as unknown as ContainerAppsAPIClient;

function run(timeoutSeconds = 300) {
  return waitForJobExecution(
    client,
    'test-rg',
    'migrate-auth-service',
    'exec-1',
    timeoutSeconds,
  );
}

describe('waitForJobExecution', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    rs.useFakeTimers();
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  describe('Standard use cases', () => {
    it('should read the given execution', async () => {
      mockJobExecution.mockResolvedValue({ status: 'Succeeded' });

      await run();

      expect(mockJobExecution).toHaveBeenCalledWith(
        'test-rg',
        'migrate-auth-service',
        'exec-1',
      );
    });

    it('should wait while the execution runs, then return how it ended', async () => {
      mockJobExecution
        .mockResolvedValueOnce({ status: 'Processing' })
        .mockResolvedValueOnce({ status: 'Running' })
        .mockResolvedValueOnce({ status: 'Succeeded' });

      const promise = run();
      await rs.runAllTimersAsync();

      expect(await promise).toEqual({ status: 'Succeeded' });
      expect(mockJobExecution).toHaveBeenCalledTimes(3);
    });

    it("should return a failure with Azure's message", async () => {
      mockJobExecution
        .mockResolvedValueOnce({ status: 'Running' })
        .mockResolvedValueOnce({
          status: 'Failed',
          message: 'Job has reached the specified backoff limit',
        });

      const promise = run();
      await rs.runAllTimersAsync();

      expect(await promise).toEqual({
        status: 'Failed',
        detail: 'Job has reached the specified backoff limit',
      });
    });

    it('should take the reason when there is no message', async () => {
      mockJobExecution.mockResolvedValue({
        status: 'Stopped',
        reason: 'StoppedByUser',
      });

      expect(await run()).toEqual({
        status: 'Stopped',
        detail: 'StoppedByUser',
      });
    });
  });

  describe('Edge cases', () => {
    it('should give up at the deadline while it still runs', async () => {
      mockJobExecution.mockResolvedValue({ status: 'Running' });

      const promise = run(12);
      await rs.runAllTimersAsync();

      expect(await promise).toEqual({ status: 'TimedOut' });
      // Reads at 0, 5, 10 and 15 s
      expect(mockJobExecution).toHaveBeenCalledTimes(4);
    });

    it('should wait out Unknown (or no status) right after the start', async () => {
      mockJobExecution
        .mockResolvedValueOnce({ status: 'Unknown' })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ status: 'Succeeded' });

      const promise = run();
      await rs.runAllTimersAsync();

      expect(await promise).toEqual({ status: 'Succeeded' });
    });

    it('should time out when the execution shows only Unknown', async () => {
      mockJobExecution.mockResolvedValue({ status: 'Unknown' });

      const promise = run(12);
      await rs.runAllTimersAsync();

      expect(await promise).toEqual({ status: 'TimedOut' });
    });

    it('should wait while the new execution is not found yet', async () => {
      const notFound = Object.assign(new Error('not found'), {
        statusCode: 404,
      });
      mockJobExecution
        .mockRejectedValueOnce(notFound)
        .mockRejectedValueOnce(notFound)
        .mockRejectedValueOnce(notFound)
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({ status: 'Succeeded' });

      const promise = run();
      await rs.runAllTimersAsync();

      expect(await promise).toEqual({ status: 'Succeeded' });
    });

    it('should throw when the execution is still not found after a minute', async () => {
      const notFound = Object.assign(new Error('not found'), {
        statusCode: 404,
      });
      mockJobExecution.mockRejectedValue(notFound);

      const promise = run();
      const outcome = expect(promise).rejects.toThrow('not found');
      await rs.runAllTimersAsync();
      await outcome;

      // 12 waits of 5 s, then one more read
      expect(mockJobExecution).toHaveBeenCalledTimes(13);
    });

    it('should read again after a failed read', async () => {
      mockJobExecution
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ status: 'Succeeded' });

      const promise = run();
      await rs.runAllTimersAsync();

      expect(await promise).toEqual({ status: 'Succeeded' });
    });

    it('should throw after three failed reads in a row', async () => {
      mockJobExecution.mockRejectedValue(new Error('ECONNRESET'));

      const promise = run();
      const outcome = expect(promise).rejects.toThrow('ECONNRESET');
      await rs.runAllTimersAsync();
      await outcome;

      expect(mockJobExecution).toHaveBeenCalledTimes(3);
    });
  });
});
