/**
 * Poll Container Apps Job Execution Status
 *
 * Polls the most recent execution of a Container Apps Job until it
 * reaches a terminal state. Used as a fallback when the LRO poller
 * fails with transient network errors.
 */

import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';

const TERMINAL_STATES = new Set([
  'Succeeded',
  'Failed',
  'Stopped',
  'Degraded',
  'Unknown',
]);

interface PollResult {
  status: string;
  executionName?: string;
}

export async function pollContainerJobStatus(
  client: ContainerAppsAPIClient,
  resourceGroupName: string,
  jobName: string,
  timeoutSeconds: number,
): Promise<PollResult> {
  const pollIntervalMs = 5_000;
  const deadline = Date.now() + timeoutSeconds * 1_000;

  while (Date.now() < deadline) {
    const executions = client.jobsExecutions.list(resourceGroupName, jobName);

    // Get the most recent execution
    let latest:
      | { name?: string; status?: string; startTime?: Date }
      | undefined;
    for await (const execution of executions) {
      if (
        !latest ||
        (execution.startTime &&
          latest.startTime &&
          execution.startTime > latest.startTime)
      ) {
        latest = execution;
      }
    }

    if (!latest) {
      return { status: 'Unknown' };
    }

    const status = latest.status ?? 'Unknown';

    if (TERMINAL_STATES.has(status)) {
      return { status, executionName: latest.name };
    }

    // Still running — wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: 'Unknown' };
}
