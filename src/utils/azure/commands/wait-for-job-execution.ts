/**
 * Wait for one Container Apps Job execution to end
 */

import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import {
  AZURE_JOB_EXECUTION_END_STATES,
  AZURE_JOB_EXECUTION_POLL_SECONDS,
  AZURE_JOB_EXECUTION_READ_ATTEMPTS,
  AZURE_JOB_START_WAIT_POLLS,
} from '../../../constants';

export interface JobExecutionEnd {
  /**
   * The state it ended in, or 'TimedOut' when it hadn't ended (or showed
   * only 'Unknown') at the deadline
   */
  status: string;
  /** Azure's reason or message for that state, when it gives one */
  detail?: string;
}

/**
 * Azure's job start ends once the execution exists, not when it has run, so
 * whether the job worked is the execution's own status: read here every few
 * seconds until it ends.
 *
 * Right after the start the execution may not be readable yet (404), or
 * show 'Unknown': both are waited out, not taken for its end (a migration
 * that succeeded was once reported failed during a deploy, 2026-11-17).
 *
 * @param client - Container Apps client
 * @param resourceGroupName - The job's resource group
 * @param jobName - The job
 * @param executionName - The execution the start answered with
 * @param timeoutSeconds - How long to wait in all
 * @returns The state it ended in
 * @throws The SDK's error when the status can't be read several times in a
 *   row, or the execution still isn't found after a minute
 */
export async function waitForJobExecution(
  client: ContainerAppsAPIClient,
  resourceGroupName: string,
  jobName: string,
  executionName: string,
  timeoutSeconds: number,
): Promise<JobExecutionEnd> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let failedReads = 0;
  let notFoundReads = 0;

  for (;;) {
    try {
      const execution = await client.jobExecution(
        resourceGroupName,
        jobName,
        executionName,
      );
      failedReads = 0;
      const status = execution.status ?? 'Unknown';
      if (status !== 'Unknown' && AZURE_JOB_EXECUTION_END_STATES.has(status)) {
        const detail = execution.message || execution.reason;
        return detail ? { status, detail } : { status };
      }
    } catch (error: unknown) {
      const notFound = (error as { statusCode?: number }).statusCode === 404;
      if (
        notFound
          ? ++notFoundReads > AZURE_JOB_START_WAIT_POLLS
          : ++failedReads >= AZURE_JOB_EXECUTION_READ_ATTEMPTS
      ) {
        throw error;
      }
    }

    if (Date.now() >= deadline) {
      return { status: 'TimedOut' };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, AZURE_JOB_EXECUTION_POLL_SECONDS * 1_000),
    );
  }
}
