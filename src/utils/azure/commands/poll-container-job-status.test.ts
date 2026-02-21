/**
 * Tests for poll-container-job-status
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { pollContainerJobStatus } from './poll-container-job-status';
import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';

function createMockClient(
  executions: Array<{
    name?: string;
    status?: string;
    startTime?: Date;
  }>,
): ContainerAppsAPIClient {
  return {
    jobsExecutions: {
      list: rs.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          for (const execution of executions) {
            yield execution;
          }
        },
      }),
    },
  } as unknown as ContainerAppsAPIClient;
}

describe('pollContainerJobStatus', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should return Succeeded when latest execution succeeded', async () => {
      const client = createMockClient([
        {
          name: 'job-abc123',
          status: 'Succeeded',
          startTime: new Date('2026-02-11T19:16:56Z'),
        },
      ]);

      const result = await pollContainerJobStatus(client, 'rg', 'job', 10);

      expect(result.status).toBe('Succeeded');
      expect(result.executionName).toBe('job-abc123');
    });

    it('should return Failed when latest execution failed', async () => {
      const client = createMockClient([
        {
          name: 'job-abc123',
          status: 'Failed',
          startTime: new Date('2026-02-11T19:16:56Z'),
        },
      ]);

      const result = await pollContainerJobStatus(client, 'rg', 'job', 10);

      expect(result.status).toBe('Failed');
      expect(result.executionName).toBe('job-abc123');
    });

    it('should pick the most recent execution by startTime', async () => {
      const client = createMockClient([
        {
          name: 'job-old',
          status: 'Failed',
          startTime: new Date('2026-02-10T10:00:00Z'),
        },
        {
          name: 'job-new',
          status: 'Succeeded',
          startTime: new Date('2026-02-11T19:16:56Z'),
        },
      ]);

      const result = await pollContainerJobStatus(client, 'rg', 'job', 10);

      expect(result.status).toBe('Succeeded');
      expect(result.executionName).toBe('job-new');
    });
  });

  describe('Edge cases', () => {
    it('should return Unknown when no executions found', async () => {
      const client = createMockClient([]);

      const result = await pollContainerJobStatus(client, 'rg', 'job', 10);

      expect(result.status).toBe('Unknown');
    });

    it('should return Unknown when status is missing', async () => {
      const client = createMockClient([
        {
          name: 'job-abc123',
          startTime: new Date('2026-02-11T19:16:56Z'),
        },
      ]);

      const result = await pollContainerJobStatus(client, 'rg', 'job', 10);

      expect(result.status).toBe('Unknown');
    });

    it('should handle Stopped status as terminal', async () => {
      const client = createMockClient([
        {
          name: 'job-abc123',
          status: 'Stopped',
          startTime: new Date('2026-02-11T19:16:56Z'),
        },
      ]);

      const result = await pollContainerJobStatus(client, 'rg', 'job', 10);

      expect(result.status).toBe('Stopped');
    });

    it('should handle Degraded status as terminal', async () => {
      const client = createMockClient([
        {
          name: 'job-abc123',
          status: 'Degraded',
          startTime: new Date('2026-02-11T19:16:56Z'),
        },
      ]);

      const result = await pollContainerJobStatus(client, 'rg', 'job', 10);

      expect(result.status).toBe('Degraded');
    });
  });
});
