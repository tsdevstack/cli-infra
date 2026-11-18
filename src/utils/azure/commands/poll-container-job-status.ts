/**
 * Poll Container Apps Job Execution Status
 *
 * Polls the most recent execution of a Container Apps Job until it
 * reaches a terminal state. Used as a fallback when the LRO poller
 * fails with transient network errors.
 */

import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import {
  AZURE_JOB_EXECUTION_END_STATES,
  AZURE_JOB_START_WAIT_POLLS,
} from '../../../constants';
import { findLatestJobExecution } from './find-latest-job-execution';

interface PollResult {
  status: string;
  executionName?: string;
}

/**
 * @param previousExecution - The newest execution before this start (null:
 *   none). Given, that one is never taken for this start's: until a newer
 *   one shows up the start is waited for, then reported as NotStarted.
 */
export async function pollContainerJobStatus(
  client: ContainerAppsAPIClient,
  resourceGroupName: string,
  jobName: string,
  timeoutSeconds: number,
  previousExecution?: string | null,
): Promise<PollResult> {
  const pollIntervalMs = 5_000;
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let notStartedPolls = 0;

  while (Date.now() < deadline) {
    const latest = await findLatestJobExecution(
      client,
      resourceGroupName,
      jobName,
    );

    if (
      previousExecution !== undefined &&
      (!latest || (latest.name ?? null) === previousExecution)
    ) {
      // This start's execution isn't listed (yet)
      if (++notStartedPolls > AZURE_JOB_START_WAIT_POLLS) {
        return { status: 'NotStarted' };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    if (!latest) {
      return { status: 'Unknown' };
    }

    const status = latest.status ?? 'Unknown';

    if (AZURE_JOB_EXECUTION_END_STATES.has(status)) {
      return { status, executionName: latest.name };
    }

    // Still running — wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: 'Unknown' };
}
