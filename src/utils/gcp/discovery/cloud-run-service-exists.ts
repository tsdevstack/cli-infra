/**
 * Check if a Cloud Run service exists
 *
 * Uses @google-cloud/run ServicesClient to check service existence.
 */

import { ServicesClient } from '@google-cloud/run';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface CloudRunServiceExistsOptions {
  serviceName: string;
  projectId: string;
  region: string;
  credentials: GCPCredentials;
}

export interface CloudRunServiceExistsResult {
  exists: boolean;
  serviceUrl?: string;
  error?: string;
}

/**
 * Check if a Cloud Run service exists
 *
 * @param options - Service details and credentials
 * @returns Result indicating if the service exists
 */
export async function cloudRunServiceExists(
  options: CloudRunServiceExistsOptions,
): Promise<CloudRunServiceExistsResult> {
  const { buildGCPClientOptions } = getContext();

  const client = new ServicesClient(buildGCPClientOptions(options.credentials));
  const name = `projects/${options.projectId}/locations/${options.region}/services/${options.serviceName}`;

  try {
    const [service] = await client.getService({ name });
    return {
      exists: true,
      serviceUrl: service.uri ?? undefined,
    };
  } catch (error: unknown) {
    // NOT_FOUND means service doesn't exist - this is not an error
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      return { exists: false };
    }
    // Any other error is a real problem
    return {
      exists: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
