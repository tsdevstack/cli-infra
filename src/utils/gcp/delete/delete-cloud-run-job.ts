/**
 * Delete Cloud Run Job
 *
 * Uses @google-cloud/run JobsClient to delete a job.
 * Idempotent: NOT_FOUND is treated as success.
 */

import { JobsClient } from '@google-cloud/run';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import type { DeleteResult } from './delete-cloud-run-service';

export interface DeleteCloudRunJobOptions {
  jobName: string;
  projectId: string;
  region: string;
  credentials: GCPCredentials;
}

/**
 * Delete a Cloud Run job
 *
 * Idempotent: Returns success if the job is already deleted.
 *
 * @param options - Job details and credentials
 * @returns Result indicating success/failure
 */
export async function deleteCloudRunJob(
  options: DeleteCloudRunJobOptions,
): Promise<DeleteResult> {
  const { buildGCPClientOptions } = getContext();

  const client = new JobsClient(buildGCPClientOptions(options.credentials));
  const name = `projects/${options.projectId}/locations/${options.region}/jobs/${options.jobName}`;

  try {
    const [operation] = await client.deleteJob({ name });
    await operation.promise();
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
