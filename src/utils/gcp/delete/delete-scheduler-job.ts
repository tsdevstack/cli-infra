/**
 * Delete Cloud Scheduler Job
 *
 * Uses @google-cloud/scheduler CloudSchedulerClient to delete a job.
 * Idempotent: NOT_FOUND is treated as success.
 */

import { CloudSchedulerClient } from '@google-cloud/scheduler';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface DeleteSchedulerJobOptions {
  jobName: string;
  projectId: string;
  region: string;
  credentials: GCPCredentials;
}

export interface DeleteSchedulerJobResult {
  success: boolean;
  deleted: boolean;
  alreadyGone?: boolean;
  error?: string;
}

/**
 * Delete a Cloud Scheduler job
 *
 * Idempotent: Returns success if job already deleted.
 *
 * @param options - Job details and credentials
 * @returns Result indicating success/failure
 */
export async function deleteSchedulerJob(
  options: DeleteSchedulerJobOptions,
): Promise<DeleteSchedulerJobResult> {
  const { buildGCPClientOptions } = getContext();

  const client = new CloudSchedulerClient(
    buildGCPClientOptions(options.credentials),
  );
  const name = `projects/${options.projectId}/locations/${options.region}/jobs/${options.jobName}`;

  try {
    await client.deleteJob({ name });
    return { success: true, deleted: true };
  } catch (error: unknown) {
    // NOT_FOUND means already deleted - this is success for idempotency
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      return { success: true, deleted: false, alreadyGone: true };
    }
    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
