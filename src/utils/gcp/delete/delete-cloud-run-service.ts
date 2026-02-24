/**
 * Delete Cloud Run Service
 *
 * Uses @google-cloud/run ServicesClient to delete a service.
 * Idempotent: NOT_FOUND is treated as success.
 */

import { ServicesClient } from '@google-cloud/run';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface DeleteCloudRunServiceOptions {
  serviceName: string;
  projectId: string;
  region: string;
  credentials: GCPCredentials;
}

export interface DeleteResult {
  success: boolean;
  deleted: boolean;
  alreadyGone?: boolean;
  error?: string;
}

/**
 * Delete a Cloud Run service
 *
 * Idempotent: Returns success if service already deleted.
 *
 * @param options - Service details and credentials
 * @returns Result indicating success/failure
 */
export async function deleteCloudRunService(
  options: DeleteCloudRunServiceOptions,
): Promise<DeleteResult> {
  const { buildGCPClientOptions } = getContext();

  const client = new ServicesClient(buildGCPClientOptions(options.credentials));
  const name = `projects/${options.projectId}/locations/${options.region}/services/${options.serviceName}`;

  try {
    const [operation] = await client.deleteService({ name });
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
