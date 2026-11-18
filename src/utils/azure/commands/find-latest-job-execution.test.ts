import { describe, it, expect, rs } from '@rstest/core';
import { findLatestJobExecution } from './find-latest-job-execution';
import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';

function createMockClient(
  executions: Array<{ name?: string; status?: string; startTime?: Date }>,
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

describe('findLatestJobExecution', () => {
  describe('Standard use cases', () => {
    it('should pick the execution that started last', async () => {
      const client = createMockClient([
        { name: 'job-new', startTime: new Date('2026-11-14T12:00:00Z') },
        { name: 'job-old', startTime: new Date('2026-11-13T12:00:00Z') },
      ]);

      expect(
        (await findLatestJobExecution(client, 'rg', 'db-init'))?.name,
      ).toBe('job-new');
      expect(client.jobsExecutions.list).toHaveBeenCalledWith('rg', 'db-init');
    });
  });

  describe('Edge cases', () => {
    it('should give undefined for a job that never ran', async () => {
      expect(
        await findLatestJobExecution(createMockClient([]), 'rg', 'db-init'),
      ).toBeUndefined();
    });
  });
});
